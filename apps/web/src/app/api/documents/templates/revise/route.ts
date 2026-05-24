import { NextResponse } from "next/server";
import {
  documentTemplateRevisionPayload,
  runDocumentTemplateRevision,
} from "../../../../../lib/documents/template-revision";
import { requireWorkspaceContext } from "../../../../../lib/workspace/context";

type TemplateRevisionRequest = {
  instruction?: unknown;
  template?: unknown;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: Request) {
  try {
    const { workspace } = await requireWorkspaceContext();
    const body = (await request.json()) as TemplateRevisionRequest;
    const instruction = textValue(body.instruction);

    if (!instruction) {
      return NextResponse.json(
        { error: "Describe the edit you want Kyro to make." },
        { status: 400 },
      );
    }

    const template = documentTemplateRevisionPayload(body.template);

    if (!template.label) {
      template.label = "Custom quote template";
    }

    const result = await runDocumentTemplateRevision({
      instruction,
      template,
      workspaceName: workspace.name,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to revise document template.",
      },
      { status: 502 },
    );
  }
}
