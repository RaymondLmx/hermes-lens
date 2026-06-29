import { describe, expect, it } from "vitest";

import { toolCapabilityForName } from "./toolCapabilities";

describe("toolCapabilityForName", () => {
  it("classifies skill tools as agent skill capability", () => {
    expect(toolCapabilityForName("skill_view").kind).toBe("skill");
    expect(toolCapabilityForName("skill_update").kind).toBe("skill");
  });

  it("classifies camera and image tools as perception capability", () => {
    expect(toolCapabilityForName("mcp_g1_get_camera_frame").kind).toBe(
      "perception",
    );
    expect(toolCapabilityForName("vision_analyze").kind).toBe("perception");
  });

  it("keeps generic mcp tools in the external capability category", () => {
    expect(toolCapabilityForName("mcp_robot_action").kind).toBe("mcp");
  });

  it("classifies common software capabilities without task-specific icons", () => {
    expect(toolCapabilityForName("browser_navigate").kind).toBe("browser");
    expect(toolCapabilityForName("terminal").kind).toBe("terminal");
    expect(toolCapabilityForName("file_read").kind).toBe("files");
    expect(toolCapabilityForName("memory_search").kind).toBe("memory");
  });
});
