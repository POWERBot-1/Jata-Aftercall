/**
 * Shipping the questionnaire to the screen (§41, §42)
 *
 * The branching rules are functions, and functions do not travel to a browser. So the server
 * evaluates them and sends the questions that are *actually relevant right now*, with their
 * current answers. The client renders and collects; the server decides what to ask next and
 * validates everything that comes back (§56).
 */

import {
  QUESTION_SECTIONS,
  isAnswered,
  questionProgress,
  questionWithOptions,
  visibleQuestions,
  type ReadinessIssue,
} from "./questionnaire";
import type { AnswerValue, PosQuestion, QuestionnaireAnswers } from "./types";

export type SerializedQuestion = Omit<PosQuestion, "when"> & {
  value: AnswerValue;
  answered: boolean;
  sectionLabel: string;
};

export type SerializedSection = {
  key: string;
  label: string;
  blurb: string;
  total: number;
  answered: number;
};

export type QuestionnaireView = {
  questions: SerializedQuestion[];
  sections: SerializedSection[];
  progress: { asked: number; answered: number; percent: number; remaining: number };
  nextId: string | null;
  missing: ReadinessIssue[];
};

function currentAnswer(answers: QuestionnaireAnswers, question: PosQuestion): AnswerValue {
  const value = answers[question.id];
  if (value === undefined || value === null || value === "") return question.defaultValue ?? (question.kind === "multi" ? [] : "");
  return value;
}

export function serializeQuestion(question: PosQuestion, answers: QuestionnaireAnswers): SerializedQuestion {
  const filled = questionWithOptions(question, answers);
  const section = QUESTION_SECTIONS.find((entry) => entry.key === question.section);
  const { when: _when, ...rest } = filled;
  void _when;
  return {
    ...rest,
    value: currentAnswer(answers, question),
    answered: isAnswered(answers, question),
    sectionLabel: section?.label ?? "Your business",
  };
}

/** The whole adaptive questionnaire as one serializable snapshot. */
export function questionnaireView(answers: QuestionnaireAnswers, missing: ReadinessIssue[] = []): QuestionnaireView {
  const visible = visibleQuestions(answers);
  const questions = visible.map((question) => serializeQuestion(question, answers));
  const sections = QUESTION_SECTIONS.map((section) => {
    const inSection = questions.filter((question) => question.section === section.key);
    return {
      key: section.key,
      label: section.label,
      blurb: section.blurb,
      total: inSection.length,
      answered: inSection.filter((question) => question.answered).length,
    };
  }).filter((section) => section.total > 0);

  const progress = questionProgress(answers);
  const next = questions.find((question) => !question.answered);

  return {
    questions,
    sections,
    progress: {
      asked: progress.total,
      answered: progress.answered,
      percent: progress.percent,
      remaining: Math.max(0, progress.total - progress.answered),
    },
    nextId: next?.id ?? null,
    missing,
  };
}
