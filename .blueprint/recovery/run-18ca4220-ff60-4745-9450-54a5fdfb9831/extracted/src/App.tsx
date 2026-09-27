import React, { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  AnswerRecord,
  AppProps,
  OXChoice,
  QuizAction,
  QuizQuestion,
  QuizState,
} from "./types";

export const DEFAULT_QUESTIONS: QuizQuestion[] = [
  {
    id: "q1",
    statement: "Water boils at 100°C at sea level.",
    answer: true,
    explanation: "At standard atmospheric pressure, pure water boils at 100°C (212°F).",
  },
  {
    id: "q2",
    statement: "The Great Wall of China is visible from the Moon with the naked eye.",
    answer: false,
    explanation: "This is a popular myth. The wall is far too narrow to be seen from the Moon.",
  },
  {
    id: "q3",
    statement: "An octopus has three hearts.",
    answer: true,
    explanation: "Octopuses have two branchial hearts and one systemic heart.",
  },
  {
    id: "q4",
    statement: "Lightning never strikes the same place twice.",
    answer: false,
    explanation: "Lightning often strikes the same place repeatedly, especially tall structures.",
  },
  {
    id: "q5",
    statement: "The Pacific Ocean is the largest ocean on Earth.",
    answer: true,
    explanation: "The Pacific covers roughly a third of Earth's surface.",
  },
];

export function choiceToBoolean(choice: OXChoice): boolean {
  return choice === "O";
}

export function booleanToChoice(value: boolean): OXChoice {
  return value ? "O" : "X";
}

export function createInitialState(questions: QuizQuestion[]): QuizState {
  return {
    questions,
    currentIndex: 0,
    phase: questions.length === 0 ? "finished" : "answering",
    records: [],
  };
}

export function quizReducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case "ANSWER": {
      if (state.phase !== "answering") return state;
      const question = state.questions[state.currentIndex];
      if (!question) return state;
      const record: AnswerRecord = {
        questionId: question.id,
        choice: action.choice,
        correct: choiceToBoolean(action.choice) === question.answer,
      };
      return { ...state, phase: "feedback", records: [...state.records, record] };
    }
    case "NEXT": {
      if (state.phase !== "feedback") return state;
      const nextIndex = state.currentIndex + 1;
      if (nextIndex >= state.questions.length) {
        return { ...state, phase: "finished" };
      }
      return { ...state, currentIndex: nextIndex, phase: "answering" };
    }
    case "RESTART":
      return createInitialState(action.questions ?? state.questions);
    default:
      return state;
  }
}

function resultMessage(ratio: number): string {
  if (ratio === 1) return "Perfect score! Outstanding!";
  if (ratio >= 0.8) return "Great job!";
  if (ratio >= 0.5) return "Good effort!";
  return "Keep practicing!";
}

const App: React.FC<AppProps> = ({
  questions = DEFAULT_QUESTIONS,
  title = "OX Quiz",
  onComplete,
}) => {
  const [state, dispatch] = useReducer(quizReducer, questions, createInitialState);
  const completedRef = useRef(false);

  const { currentIndex, phase, records } = state;
  const quizQuestions = state.questions;
  const total = quizQuestions.length;
  const current = quizQuestions[currentIndex];
  const lastRecord = records[records.length - 1];
  const score = records.filter((r) => r.correct).length;
  const isLast = currentIndex === total - 1;

  const answer = useCallback((choice: OXChoice) => dispatch({ type: "ANSWER", choice }), []);
  const next = useCallback(() => dispatch({ type: "NEXT" }), []);
  const restart = useCallback(() => {
    completedRef.current = false;
    dispatch({ type: "RESTART" });
  }, []);

  // Notify completion once per run.
  useEffect(() => {
    if (phase === "finished" && total > 0 && !completedRef.current) {
      completedRef.current = true;
      onComplete?.(score, total, records);
    }
  }, [phase, total, score, records, onComplete]);

  // Keyboard shortcuts: O / X to answer, Enter to continue.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "BUTTON" || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (phase === "answering") {
        if (key === "o") answer("O");
        else if (key === "x") answer("X");
      } else if (phase === "feedback" && key === "enter") {
        next();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [phase, answer, next]);

  if (total === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="bg-white rounded-2xl shadow p-8 text-center">
          <h1 className="text-2xl font-bold mb-2">{title}</h1>
          <p className="text-slate-600">No questions available.</p>
        </div>
      </main>
    );
  }

  if (phase === "finished") {
    const ratio = score / total;
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <section
          className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-lg"
          aria-labelledby="result-heading"
        >
          <h1 id="result-heading" className="text-2xl font-bold text-center mb-4">
            Quiz Complete
          </h1>
          <p data-testid="final-score" className="text-5xl font-extrabold text-center text-indigo-600">
            {score} / {total}
          </p>
          <p className="text-center text-slate-600 mt-2">
            {Math.round(ratio * 100)}% — {resultMessage(ratio)}
          </p>
          <ul className="mt-6 space-y-2" aria-label="Answer review">
            {quizQuestions.map((q, i) => {
              const rec = records.find((r) => r.questionId === q.id);
              const ok = rec?.correct ?? false;
              return (
                <li
                  key={q.id}
                  className={`flex items-start gap-3 rounded-lg p-3 text-sm ${
                    ok ? "bg-emerald-50" : "bg-rose-50"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`font-bold ${ok ? "text-emerald-600" : "text-rose-600"}`}
                  >
                    {ok ? "✓" : "✗"}
                  </span>
                  <span className="flex-1">
                    {i + 1}. {q.statement}{" "}
                    <span className="text-slate-500">
                      (Answer: {booleanToChoice(q.answer)}
                      {rec ? `, yours: ${rec.choice}` : ""})
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={restart}
            className="mt-6 w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-300"
          >
            Restart Quiz
          </button>
        </section>
      </main>
    );
  }

  const answered = phase === "feedback";
  const progress = ((currentIndex + (answered ? 1 : 0)) / total) * 100;

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <section className="bg-white rounded-2xl shadow-lg p-6 sm:p-8 w-full max-w-lg">
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">{title}</h1>
            <span className="text-sm text-slate-500">Score: {score}</span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Question {currentIndex + 1} of {total}
          </p>
          <div
            className="mt-2 h-2 w-full rounded-full bg-slate-200 overflow-hidden"
            role="progressbar"
            aria-label="Quiz progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </header>

        <p data-testid="question-statement" className="text-lg font-medium text-center min-h-[4rem]">
          {current.statement}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <button
            type="button"
            aria-label="O (True)"
            disabled={answered}
            onClick={() => answer("O")}
            className={`rounded-2xl py-6 text-5xl font-extrabold border-4 transition focus:outline-none focus:ring-4 focus:ring-sky-300 disabled:cursor-not-allowed ${
              answered && lastRecord?.choice === "O"
                ? "border-sky-600 bg-sky-100 text-sky-700"
                : "border-sky-300 text-sky-600 hover:bg-sky-50 disabled:opacity-50"
            }`}
          >
            O
          </button>
          <button
            type="button"
            aria-label="X (False)"
            disabled={answered}
            onClick={() => answer("X")}
            className={`rounded-2xl py-6 text-5xl font-extrabold border-4 transition focus:outline-none focus:ring-4 focus:ring-rose-300 disabled:cursor-not-allowed ${
              answered && lastRecord?.choice === "X"
                ? "border-rose-600 bg-rose-100 text-rose-700"
                : "border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            }`}
          >
            X
          </button>
        </div>

        {answered && lastRecord && (
          <div
            role="status"
            aria-live="polite"
            className={`mt-6 rounded-xl p-4 ${
              lastRecord.correct ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
            }`}
          >
            <p className="font-bold text-lg">{lastRecord.correct ? "Correct!" : "Incorrect"}</p>
            <p className="text-sm mt-1">The answer is {booleanToChoice(current.answer)}.</p>
            {current.explanation && <p className="text-sm mt-1">{current.explanation}</p>}
          </div>
        )}

        {answered && (
          <button
            type="button"
            onClick={next}
            className="mt-4 w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-300"
          >
            {isLast ? "See Results" : "Next Question"}
          </button>
        )}

        <p className="mt-4 text-center text-xs text-slate-400">
          Keyboard: press O or X to answer, Enter to continue.
        </p>
      </section>
    </main>
  );
};

export default App;
