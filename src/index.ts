/**
 * AI Agent Platform v0.1
 *
 * 진입점: 전체 시스템 초기화 및 실행
 * 현재 상태: Developer Agent 구현 준비
 */

import { createOrchestrator } from "./orchestrator";
import { createDeveloperAgent } from "./agents";

async function main() {
  console.log("🚀 AI Agent Platform v0.1");
  console.log("");

  try {
    // 1. Orchestrator 초기화
    console.log("1️⃣  Initializing Orchestrator...");
    const orchestrator = createOrchestrator();
    orchestrator.printStatus();
    console.log("");

    // 2. Developer Agent 초기화 (v0.1 focus)
    console.log("2️⃣  Initializing Developer Agent...");
    const developerAgent = await createDeveloperAgent();
    console.log(developerAgent.getStatus());
    console.log("");

    // 3. 간단한 Task 생성 및 실행 (테스트)
    console.log("3️⃣  Creating and executing a sample task...");
    const taskId = orchestrator.createTask("agent_developer", {
      action: "test",
      description: "Verify Developer Agent is working",
    });
    console.log(`Task created: ${taskId}`);

    await orchestrator.executeTask(taskId);
    const taskStatus = orchestrator.getTaskStatus(taskId);
    console.log("Task result:", taskStatus?.output);
    console.log("");

    console.log("✅ All systems operational!");
    console.log("");
    console.log("Next steps:");
    console.log("1. Review CLAUDE.md for project constraints");
    console.log("2. Run: npm run check:arch -- contracts/patterns/minigame_shell_v1.json src/agents");
    console.log("3. Implement Developer Agent specific features");
    console.log("4. Use /blueprint skill for v0.2 planning");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
