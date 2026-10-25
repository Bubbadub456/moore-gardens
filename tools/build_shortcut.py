#!/usr/bin/env python3
"""Builds the "Post to Moore Gardens" iPhone shortcut.

    python3 tools/build_shortcut.py && shortcuts sign --mode anyone \
        --input /tmp/unsigned.shortcut --output "shortcut/Post to Moore Gardens.shortcut"

What the shortcut does: asks once for tags and plant (used for every photo in
the share), then for each photo shared to it (or picked, if run on its own):
resize to 2000px, convert to JPEG without metadata, ask for a title, and POST
it to /api/photo?publish=1. The upload password is asked once, when the
shortcut is added, so it is never stored in this public file.
"""
import plistlib
import sys
import uuid

API_URL = "https://www.mooregardens.farm/api/photo?publish=1"
OBJ = "￼"  # placeholder character where a variable goes inside text


def uid():
    return str(uuid.uuid4()).upper()


def var(name):
    return {"Type": "Variable", "VariableName": name}


def out(action_uuid, name):
    return {"Type": "ActionOutput", "OutputUUID": action_uuid, "OutputName": name}


def attach(ref):
    """A parameter that takes a single variable."""
    return {"Value": ref, "WFSerializationType": "WFTextTokenAttachment"}


def text(*parts):
    """Text with variables mixed in: text("Bearer ", var("Password"))."""
    s, ranges = "", {}
    for p in parts:
        if isinstance(p, str):
            s += p
        else:
            pos = len(s.encode("utf-16-le")) // 2
            ranges[f"{{{pos}, 1}}"] = p
            s += OBJ
    value = {"string": s}
    if ranges:
        value["attachmentsByRange"] = ranges
    return {"Value": value, "WFSerializationType": "WFTextTokenString"}


def dictionary(pairs):
    return {
        "Value": {
            "WFDictionaryFieldValueItems": [
                {"WFItemType": 0, "WFKey": text(k), "WFValue": v} for k, v in pairs
            ]
        },
        "WFSerializationType": "WFDictionaryFieldValue",
    }


def action(identifier, **params):
    return {"WFWorkflowActionIdentifier": identifier, "WFWorkflowActionParameters": params}


def build():
    pw, sel, cnt, rs, cv, b64, title, tags, plant, resp, msg = (uid() for _ in range(11))
    if_group, repeat_group = uid(), uid()

    actions = [
        # 0: the password, filled in by the import question
        action("is.workflow.actions.gettext", UUID=pw, WFTextActionText=""),
        action("is.workflow.actions.setvariable", WFVariableName="Password",
               WFInput=attach(out(pw, "Text"))),

        # Photos from the share sheet, or pick some if run from the Shortcuts app
        action("is.workflow.actions.conditional", GroupingIdentifier=if_group,
               WFControlFlowMode=0, WFCondition=100,
               WFInput={"Type": "Variable", "Variable": attach({"Type": "ExtensionInput"})}),
        action("is.workflow.actions.setvariable", WFVariableName="Photos",
               WFInput=attach({"Type": "ExtensionInput"})),
        action("is.workflow.actions.conditional", GroupingIdentifier=if_group, WFControlFlowMode=1),
        action("is.workflow.actions.selectphoto", UUID=sel, WFSelectMultiplePhotos=True),
        action("is.workflow.actions.setvariable", WFVariableName="Photos",
               WFInput=attach(out(sel, "Photos"))),
        action("is.workflow.actions.conditional", GroupingIdentifier=if_group, WFControlFlowMode=2),

        action("is.workflow.actions.count", UUID=cnt, WFCountType="Items", Input=attach(var("Photos"))),

        # Tags and plant are asked once and used for every photo in this share
        action("is.workflow.actions.ask", UUID=tags, WFInputType="Text",
               WFAskActionPrompt=text("Tags? Optional, separated by commas (e.g. bloom, pollinators). "
                                      "Used for all ", out(cnt, "Count"), " photo(s).")),
        action("is.workflow.actions.ask", UUID=plant, WFInputType="Text",
               WFAskActionPrompt=text("Plant name? Optional. Used for all ", out(cnt, "Count"), " photo(s).")),

        action("is.workflow.actions.repeat.each", GroupingIdentifier=repeat_group,
               WFControlFlowMode=0, WFInput=attach(var("Photos"))),

        action("is.workflow.actions.image.resize", UUID=rs, WFImage=attach(var("Repeat Item")),
               WFImageResizeKey="Longest Edge", WFImageResizeLength="2000"),
        action("is.workflow.actions.image.convert", UUID=cv, WFInput=attach(out(rs, "Resized Image")),
               WFImageFormat="JPEG", WFImageCompressionQuality=0.85, WFImagePreserveMetadata=False),
        action("is.workflow.actions.base64encode", UUID=b64, WFInput=attach(out(cv, "Converted Image")),
               WFEncodeMode="Encode", WFBase64LineBreakMode="None"),

        action("is.workflow.actions.ask", UUID=title, WFInputType="Text",
               WFAskActionPrompt=text("Title for photo ", var("Repeat Index"), " of ", out(cnt, "Count"), "?")),

        action("is.workflow.actions.downloadurl", UUID=resp,
               WFURL=API_URL, WFHTTPMethod="POST", WFHTTPBodyType="JSON",
               ShowHeaders=True,
               WFHTTPHeaders=dictionary([("Authorization", text("Bearer ", var("Password")))]),
               WFJSONValues=dictionary([
                   ("image", text(out(b64, "Base64 Encoded"))),
                   ("title", text(out(title, "Provided Input"))),
                   ("tags", text(out(tags, "Provided Input"))),
                   ("plant", text(out(plant, "Provided Input"))),
               ])),
        action("is.workflow.actions.getvalueforkey", UUID=msg, WFGetDictionaryValueType="Value",
               WFDictionaryKey="message", WFInput=attach(out(resp, "Contents of URL"))),
        action("is.workflow.actions.notification", WFNotificationActionTitle="Moore Gardens",
               WFNotificationActionBody=text(out(msg, "Dictionary Value")),
               WFNotificationActionSound=True),

        action("is.workflow.actions.repeat.each", GroupingIdentifier=repeat_group, WFControlFlowMode=2),
    ]

    return {
        "WFWorkflowClientVersion": "2302.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4292093695, "WFWorkflowIconGlyphNumber": 59511},
        "WFWorkflowTypes": ["ActionExtension"],
        "WFWorkflowInputContentItemClasses": ["WFImageContentItem", "WFPhotoMediaContentItem"],
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowImportQuestions": [{
            "ActionIndex": 0,
            "Category": "Parameter",
            "ParameterKey": "WFTextActionText",
            "DefaultValue": "",
            "Text": "Your Moore Gardens upload password (the same one as the upload page)",
        }],
        "WFWorkflowActions": actions,
    }


if __name__ == "__main__":
    dest = sys.argv[1] if len(sys.argv) > 1 else "/tmp/unsigned.shortcut"
    with open(dest, "wb") as f:
        plistlib.dump(build(), f, fmt=plistlib.FMT_BINARY)
    print(dest)
