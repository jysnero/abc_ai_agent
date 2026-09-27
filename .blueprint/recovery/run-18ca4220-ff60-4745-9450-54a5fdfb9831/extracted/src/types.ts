/**
 * Shared type definitions for the OX (True/False) quiz component.
 */

/** A user's choice: "O" means true, "X" means false. */
export type OXChoice = "O" | "X";

/** A single OX quiz question. */
export interface QuizQuestion {
  /** Unique identifier for the question. */
  id: string;
  /** The statement the user must judge as true (O) or false (X). */
  statement: string;
  /** The correct answer: true => "O", false => "X". */
  answer: boolean;
  /** Optional explanation shown after the user answers. */
  explanation?: string;
}

/** Record of a single answered question. */
export interface AnswerRecord {
  questionId: string;
  choice: OXChoice;
  correct: boolean;
}

/** The current phase of the quiz flow. */
export type QuizPhase = "answering" | "feedback" | "finished";

/** Complete internal state of the quiz. */
export interface QuizState {
  questions: QuizQuestion[];
  currentIndex: number;
  phase: QuizPhase;
  records: AnswerRecord[];
}

/** Actions accepted by the quiz reducer. */
export type QuizAction =
  | { type: "ANSWER"; choice: OXChoice }
  | { type: "NEXT" }
  | { type: "RESTART"; questions?: QuizQuestion[] };

/** Props accepted by the App component. */
export interface AppProps {
  /** Optional custom question set. Defaults to a built-in set. */
  questions?: QuizQuestion[];
  /** Optional title displayed in the header. */
  title?: string;
  /** Optional callback invoked when the quiz finishes. */
  onComplete?: (score: number, total: number, records: AnswerRecord[]) => void;
}
