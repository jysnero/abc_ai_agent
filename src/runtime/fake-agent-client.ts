/**
 * Fake Agent Client
 *
 * 테스트용 mock AgentClient
 * 실제 Claude API 호출 없이 통합 테스트 가능
 */

import type { IAgentClient, AgentClientConfig, AgentMessage, AgentResponse } from "./agent-client.js";

export enum FakeScenario {
  SUCCESS = "success",                    // 정상 완료
  VALIDATION_FAILURE = "validation_failure", // 검증 실패
  REPAIR_FAILURE = "repair_failure",      // 수정 실패 (3회 초과)
  RANGE_EXCEEDED = "range_exceeded",      // 범위 초과
}

/**
 * Fake Agent Client 구현
 */
export class FakeAgentClient implements IAgentClient {
  private scenario: FakeScenario;
  private callCount: number = 0;

  constructor(scenario: FakeScenario = FakeScenario.SUCCESS) {
    this.scenario = scenario;
  }

  getCallCount(): number {
    return this.callCount;
  }

  async chat(
    messages: AgentMessage[],
    systemPrompt?: string
  ): Promise<AgentResponse> {
    this.callCount++;

    // 시나리오별 응답
    switch (this.scenario) {
      case FakeScenario.SUCCESS:
        return this.generateSuccessResponse();

      case FakeScenario.VALIDATION_FAILURE:
        return this.generateValidationFailureResponse();

      case FakeScenario.REPAIR_FAILURE:
        // 3회 이상이면 포기
        if (this.callCount > 3) {
          return this.generateRepairFailureResponse();
        }
        return this.generateValidationFailureResponse();

      case FakeScenario.RANGE_EXCEEDED:
        return this.generateRangeExceededResponse();

      default:
        return this.generateSuccessResponse();
    }
  }

  /**
   * 정상 응답 (Checkbox 컴포넌트) - 마크다운 형식
   */
  private generateSuccessResponse(): AgentResponse {
    const checkboxTsx = `import React, { useState } from 'react';

export interface CheckboxProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Checkbox({
  checked = false,
  onChange,
  label,
  disabled = false,
}: CheckboxProps): JSX.Element {
  const [isChecked, setIsChecked] = useState(checked);

  const handleChange = () => {
    if (!disabled) {
      const newState = !isChecked;
      setIsChecked(newState);
      onChange?.(newState);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === ' ' && !disabled) {
      e.preventDefault();
      handleChange();
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={isChecked}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-label={label || 'Checkbox'}
        aria-checked={isChecked}
        className="w-4 h-4 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-2 focus:outline-offset-2 focus:outline-blue-500"
      />
      {label && (
        <label className="text-sm font-medium cursor-pointer disabled:opacity-50">
          {label}
        </label>
      )}
    </div>
  );
}`;

    const testFile = `import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Checkbox } from './Checkbox';

describe('Checkbox Component', () => {
  it('renders checkbox element', () => {
    const { container } = render(<Checkbox label="Test" />);
    expect(container.querySelector('input[type="checkbox"]')).toBeInTheDocument();
  });
});`;

    const readmeFile = `# Checkbox Component

A reusable React checkbox component with TypeScript support and accessibility features.

## Usage

\`\`\`tsx
import { Checkbox } from './src/Checkbox';

export function App() {
  const [checked, setChecked] = React.useState(false);
  return (
    <Checkbox
      checked={checked}
      onChange={setChecked}
      label="Accept terms"
    />
  );
}
\`\`\`

## Props

- checked: boolean
- onChange: (checked: boolean) => void
- label: string
- disabled: boolean
`;

    // Markdown format for developer agent parsing
    const markdownContent = `## Checkbox Component

### File: src/Checkbox.tsx
${checkboxTsx}

### Test: src/Checkbox.test.tsx
${testFile}

### File: README.md
${readmeFile}

All files generated successfully.`;

    return {
      content: markdownContent,
      stop_reason: "end_turn",
      usage: { input_tokens: 500, output_tokens: 2000 },
    };
  }

  /**
   * 검증 실패 응답 (의도적인 타입 오류) - 마크다운 형식
   */
  private generateValidationFailureResponse(): AgentResponse {
    const checkboxWithTypeError = `import React, { useState } from 'react';

export interface CheckboxProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Checkbox({
  checked = false,
  onChange,
  label,
  disabled = false,
}: CheckboxProps): JSX.Element {
  const [isChecked, setIsChecked]: number = useState(checked); // TYPE ERROR

  const handleChange = () => {
    if (!disabled) {
      const newState = !isChecked;
      setIsChecked(newState);
      onChange?.(newState);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={isChecked}
        onChange={handleChange}
        disabled={disabled}
        aria-label={label || 'Checkbox'}
        aria-checked={isChecked}
      />
    </div>
  );
}`;

    const testFile = `import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('renders', () => {
    const { container } = render(<Checkbox />);
    expect(container.querySelector('input')).toBeInTheDocument();
  });
});`;

    const readmeFile = `# Checkbox Component

Incomplete version with build error.
`;

    const markdownContent = `## Checkbox Component (With Errors)

### File: src/Checkbox.tsx
${checkboxWithTypeError}

### Test: src/Checkbox.test.tsx
${testFile}

### File: README.md
${readmeFile}

Has TypeScript compilation errors.`;

    return {
      content: markdownContent,
      stop_reason: "end_turn",
      usage: { input_tokens: 500, output_tokens: 1000 },
    };
  }

  /**
   * 수정 실패 응답
   */
  private generateRepairFailureResponse(): AgentResponse {
    const markdownContent = `## Repair Failed

Maximum repair attempts exceeded. Unable to fix the code within constraints.

### File: src/Checkbox.tsx
// Unable to fix

Cannot proceed.`;

    return {
      content: markdownContent,
      stop_reason: "end_turn",
      usage: { input_tokens: 500, output_tokens: 200 },
    };
  }

  /**
   * 범위 초과 응답
   */
  private generateRangeExceededResponse(): AgentResponse {
    const markdownContent = `## Generated Code

### File: src/Checkbox.tsx
export function Checkbox() { return null; }

### File: src/unauthorized/new-file.ts
// File outside contract`;

    return {
      content: markdownContent,
      stop_reason: "end_turn",
      usage: { input_tokens: 500, output_tokens: 400 },
    };
  }
}
