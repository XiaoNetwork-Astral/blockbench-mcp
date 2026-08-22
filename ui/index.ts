import type { IMCPTool } from "@/types";
import { statusBarSetup, statusBarTeardown } from "@/ui/statusBar";
import { auditPanelSetup, auditPanelTeardown } from "@/ui/auditPanel";

export function uiSetup({
  tools,
}: {
  tools: Record<string, IMCPTool>;
}): void {
  statusBarSetup();
  auditPanelSetup(tools);
}

export function uiTeardown(): void {
  auditPanelTeardown();
  statusBarTeardown();
}
