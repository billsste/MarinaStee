/*
 * Tool registry — every new tool registers here at module-load.
 *
 * Consumers:
 *   - app/api/agent/route.ts  imports `registeredToolSchemas()` → ACTION_TOOLS
 *   - lib/agent-fetch.ts      imports `resolveRegisteredTool()` → dispatcher
 *   - lib/agent-actions.ts    imports `registeredToolPermissions()` → ACTION_PERMISSION
 *
 * Adding a new tool: write `lib/agent-tools/<name>.ts` with defineTool({...}),
 * then add the registerTool() call here. That's the full wiring.
 */

import { registerTool } from "@/lib/agent-tool-kit";
import { NavigateToTool } from "@/lib/agent-tools/navigate-to";
import { ScheduleReminderTool } from "@/lib/agent-tools/schedule-reminder";

registerTool(NavigateToTool);
registerTool(ScheduleReminderTool);

// Re-export the registry readers so consumers only import from this index
// (single import target → harder to forget the side-effect registration).
export {
  registeredToolSchemas,
  registeredToolPermissions,
  resolveRegisteredTool,
} from "@/lib/agent-tool-kit";
