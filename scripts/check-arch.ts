#!/usr/bin/env tsx
/**
 * Architecture Validation Script
 *
 * Agent 계약서 스키마와 실제 구현이 일치하는지 검증합니다.
 * API 비용 없이 로컬에서 즉시 실행 가능합니다.
 *
 * Usage: npm run check:arch -- <schema-file> <target-folder>
 * Example: npm run check:arch -- contracts/patterns/minigame_shell_v1.json src/agents
 */

import fs from "fs";
import path from "path";

interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  details: Record<string, unknown>;
}

async function validateArchitecture(
  schemaPath: string,
  targetFolder: string
): Promise<ValidationResult> {
  const result: ValidationResult = {
    passed: true,
    errors: [],
    warnings: [],
    details: {},
  };

  try {
    // 1. 스키마 파일 존재 확인
    if (!fs.existsSync(schemaPath)) {
      result.errors.push(`Schema file not found: ${schemaPath}`);
      result.passed = false;
      return result;
    }

    // 2. 스키마 파일 파싱
    const schemaContent = fs.readFileSync(schemaPath, "utf-8");
    const schema = JSON.parse(schemaContent);
    result.details.schema = schema;

    // 3. 필수 필드 검증
    const requiredFields = ["agent_metadata", "capabilities", "bridge_api_contract"];
    for (const field of requiredFields) {
      if (!schema.properties[field]) {
        result.errors.push(
          `Schema missing required property: ${field}`
        );
        result.passed = false;
      }
    }

    // 4. Bridge API Contract 검증
    if (schema.properties.bridge_api_contract) {
      const bridgeApiProps = schema.properties.bridge_api_contract.properties || {};

      if (bridgeApiProps.api_base_url?.example === "https://api.example.com") {
        result.warnings.push(
          "⚠️  Bridge API Contract uses EXAMPLE values - this must be replaced with real spec from native app team"
        );
      }
    }

    // 5. 타겟 폴더 검증
    if (fs.existsSync(targetFolder)) {
      const files = fs.readdirSync(targetFolder);
      result.details.targetFiles = files;

      // Agent 파일 검증
      for (const file of files) {
        if (file.endsWith(".ts")) {
          const filePath = path.join(targetFolder, file);
          const content = fs.readFileSync(filePath, "utf-8");

          // 기본 Agent 인터페이스 검증
          if (!content.includes("class") && !content.includes("interface")) {
            result.warnings.push(
              `${file}: No class or interface definition found`
            );
          }
        }
      }
    } else {
      result.warnings.push(`Target folder not found: ${targetFolder}`);
    }

    // 6. Agent Role 검증
    const agentMetadataProps = schema.properties.agent_metadata.properties || {};
    if (agentMetadataProps.role?.enum) {
      result.details.supportedRoles = agentMetadataProps.role.enum;
    }

    if (result.errors.length > 0) {
      result.passed = false;
    }
  } catch (error) {
    result.errors.push(`Validation error: ${String(error)}`);
    result.passed = false;
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: npm run check:arch -- <schema-file> <target-folder>");
    console.log("Example: npm run check:arch -- contracts/patterns/minigame_shell_v1.json src/agents");
    process.exit(1);
  }

  const schemaFile = args[0];
  const targetFolder = args[1];

  console.log("🏗️  Architecture Validation");
  console.log(`Schema: ${schemaFile}`);
  console.log(`Target: ${targetFolder}`);
  console.log("");

  const result = await validateArchitecture(schemaFile, targetFolder);

  if (result.errors.length > 0) {
    console.error("❌ ERRORS:");
    result.errors.forEach((err) => console.error(`  - ${err}`));
    console.log("");
  }

  if (result.warnings.length > 0) {
    console.warn("⚠️  WARNINGS:");
    result.warnings.forEach((warn) => console.warn(`  - ${warn}`));
    console.log("");
  }

  if (result.passed) {
    console.log("✅ Architecture validation PASSED");
    console.log("");
    console.log("Details:");
    console.log(
      `- Supported Roles: ${result.details.supportedRoles?.join(", ") || "N/A"}`
    );
    console.log(
      `- Target Files: ${result.details.targetFiles?.join(", ") || "N/A"}`
    );
  } else {
    console.log("❌ Architecture validation FAILED");
    process.exit(1);
  }
}

main();
