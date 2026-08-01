import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  CheckIcon,
  LoaderCircleIcon,
  SparklesIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  optimizeStylePrompt,
  type PromptOptimizationAnswer,
  type PromptOptimizationQuestion,
  type PromptOptimizationResponse,
} from "@/lib/backend";
import { useI18n } from "@/lib/i18n";

type PromptOptimizerDialogProps = {
  open: boolean;
  currentPrompt: string;
  providerId: string | null;
  onOpenChange: (open: boolean) => void;
  onApply: (prompt: string) => void;
};

type OptimizerStatus = "loading" | "question" | "final" | "error";

const CUSTOM_ANSWER = "__custom_answer__";

function getErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error);
}

function readOptimizedPrompt(response: PromptOptimizationResponse) {
  if (response.kind !== "final") return null;
  const legacyResponse = response as PromptOptimizationResponse & {
    optimized_prompt?: unknown;
  };
  if (typeof response.optimizedPrompt === "string") {
    return response.optimizedPrompt;
  }
  return typeof legacyResponse.optimized_prompt === "string"
    ? legacyResponse.optimized_prompt
    : null;
}

export function PromptOptimizerDialog({
  open,
  currentPrompt,
  providerId,
  onOpenChange,
  onApply,
}: PromptOptimizerDialogProps) {
  const { locale, t } = useI18n();
  const [answers, setAnswers] = useState<PromptOptimizationAnswer[]>([]);
  const [question, setQuestion] = useState<PromptOptimizationQuestion | null>(
    null,
  );
  const [round, setRound] = useState(1);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [customAnswer, setCustomAnswer] = useState("");
  const [optimizedPrompt, setOptimizedPrompt] = useState("");
  const [status, setStatus] = useState<OptimizerStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const askAI = useCallback(
    async (nextAnswers: PromptOptimizationAnswer[]) => {
      const requestId = ++requestIdRef.current;
      setStatus("loading");
      setError(null);

      if (!providerId) {
        if (requestId === requestIdRef.current) {
          setStatus("error");
          setError(t("styleOptimizeNoProvider"));
        }
        return;
      }

      try {
        const response: PromptOptimizationResponse =
          await optimizeStylePrompt({
            providerId,
            currentPrompt,
            answers: nextAnswers,
            interfaceLanguage: locale,
          });
        if (requestId !== requestIdRef.current) return;

        if (response.kind === "question") {
          setQuestion(response.question);
          setRound(response.round);
          setStatus("question");
        } else {
          const nextPrompt = readOptimizedPrompt(response);
          if (!nextPrompt?.trim()) {
            setStatus("error");
            setError(t("styleOptimizeErrorDescription"));
          } else {
            setOptimizedPrompt(nextPrompt);
            setStatus("final");
          }
        }
      } catch (requestError) {
        if (requestId !== requestIdRef.current) return;
        setStatus("error");
        setError(getErrorMessage(requestError));
      }
    },
    [currentPrompt, locale, providerId, t],
  );

  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1;
      return;
    }

    setAnswers([]);
    setQuestion(null);
    setRound(1);
    setSelectedAnswer(null);
    setCustomAnswer("");
    setOptimizedPrompt("");
    void askAI([]);

    return () => {
      requestIdRef.current += 1;
    };
  }, [askAI, open]);

  const answerText =
    selectedAnswer === CUSTOM_ANSWER
      ? customAnswer.trim()
      : selectedAnswer?.trim() ?? "";
  const canContinue = status === "question" && answerText.length > 0;

  function handleContinue() {
    if (!question || !canContinue) return;
    const nextAnswers = [
      ...answers,
      { question: question.text, answer: answerText },
    ];
    setAnswers(nextAnswers);
    setSelectedAnswer(null);
    setCustomAnswer("");
    void askAI(nextAnswers);
  }

  function restart() {
    setAnswers([]);
    setQuestion(null);
    setRound(1);
    setSelectedAnswer(null);
    setCustomAnswer("");
    setOptimizedPrompt("");
    void askAI([]);
  }

  function applyPrompt() {
    const prompt = optimizedPrompt.trim();
    if (!prompt) return;
    onApply(prompt);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] max-w-xl gap-0 overflow-y-auto overscroll-contain p-0 sm:max-w-2xl">
        {status === "final" ? (
          <>
            <DialogHeader className="border-b bg-gradient-to-br from-primary/12 via-background to-background px-5 py-5 pr-12">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                  <CheckIcon className="size-5" />
                </div>
                <div className="grid gap-1">
                  <DialogTitle>{t("styleOptimizeFinalTitle")}</DialogTitle>
                  <DialogDescription>
                    {t("styleOptimizeFinalDescription")}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="grid gap-2 px-5 py-5">
              <p className="text-xs font-medium text-muted-foreground">
                {t("stylePrompt")}
              </p>
              <Textarea
                value={optimizedPrompt}
                onChange={(event) => setOptimizedPrompt(event.currentTarget.value)}
                className="min-h-40 resize-y bg-background"
                autoFocus
              />
            </div>
            <div className="flex flex-col-reverse gap-2 border-t bg-muted/40 px-5 py-4 sm:flex-row sm:justify-between">
              <Button variant="ghost" onClick={restart}>
                <ArrowLeftIcon />
                {t("styleOptimizeRestart")}
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {t("cancel")}
                </Button>
                <Button onClick={applyPrompt} disabled={!optimizedPrompt.trim()}>
                  <CheckIcon />
                  {t("styleOptimizeApply")}
                </Button>
              </div>
            </div>
          </>
        ) : status === "question" && question ? (
          <>
            <DialogHeader className="border-b bg-gradient-to-br from-primary/10 via-background to-background px-5 py-5 pr-12">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
                  <SparklesIcon className="size-5" />
                </div>
                <div className="grid gap-1">
                  <DialogTitle>{t("styleOptimizeDialogTitle")}</DialogTitle>
                  <DialogDescription>
                    {t("styleOptimizeDialogDescription")}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="grid gap-5 px-5 py-5">
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{t("styleOptimizeRound", { round: String(round) })}</span>
                  <span>{t("styleOptimizeAnswerCount", { count: String(answers.length) })}</span>
                </div>
                <div
                  className="h-1 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={3}
                  aria-valuenow={round}
                  aria-label={t("styleOptimizeProgress")}
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${Math.min((round / 3) * 100, 100)}%` }}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <p className="text-lg font-semibold leading-snug">
                  {question.text}
                </p>
                {answers.length === 0 && (
                  <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t("styleOptimizeCurrentPrompt")}
                    </p>
                    <p className="mt-1 max-h-16 overflow-y-auto whitespace-pre-wrap text-sm text-foreground/80">
                      {currentPrompt.trim() || t("styleOptimizeNoExistingPrompt")}
                    </p>
                  </div>
                )}
              </div>

              <div
                className="grid gap-2 sm:grid-cols-2"
                role="group"
                aria-label={question.text}
              >
                {question.options.map((option) => {
                  const selected = selectedAnswer === option;
                  return (
                    <Button
                      key={option}
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setSelectedAnswer(option);
                        setCustomAnswer("");
                      }}
                      aria-pressed={selected}
                      className={`h-auto min-h-11 justify-start whitespace-normal px-3 py-2.5 text-left ${
                        selected
                          ? "border-primary bg-primary/8 text-foreground ring-2 ring-primary/20"
                          : "hover:border-primary/40"
                      }`}
                    >
                      <span className="min-w-0 flex-1">{option}</span>
                      {selected && <CheckIcon className="size-4 text-primary" />}
                    </Button>
                  );
                })}
                {question.allowCustom && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSelectedAnswer(CUSTOM_ANSWER)}
                    aria-pressed={selectedAnswer === CUSTOM_ANSWER}
                    className={`h-auto min-h-11 justify-start whitespace-normal px-3 py-2.5 text-left ${
                      selectedAnswer === CUSTOM_ANSWER
                        ? "border-primary bg-primary/8 text-foreground ring-2 ring-primary/20"
                        : "border-dashed hover:border-primary/40"
                    }`}
                  >
                    <span className="min-w-0 flex-1">{t("styleOptimizeCustomAnswer")}</span>
                    {selectedAnswer === CUSTOM_ANSWER && (
                      <CheckIcon className="size-4 text-primary" />
                    )}
                  </Button>
                )}
              </div>

              {selectedAnswer === CUSTOM_ANSWER && (
                <Textarea
                  value={customAnswer}
                  onChange={(event) => setCustomAnswer(event.currentTarget.value)}
                  placeholder={t("styleOptimizeCustomPlaceholder")}
                  className="min-h-20 resize-y"
                  autoFocus
                />
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t bg-muted/40 px-5 py-4 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("cancel")}
              </Button>
              <Button onClick={handleContinue} disabled={!canContinue}>
                {t("styleOptimizeContinue")}
              </Button>
            </div>
          </>
        ) : status === "error" ? (
          <>
            <DialogHeader className="border-b bg-gradient-to-br from-destructive/8 via-background to-background px-5 py-5 pr-12">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-destructive/10 text-destructive ring-1 ring-destructive/15">
                  <SparklesIcon className="size-5" />
                </div>
                <div className="grid gap-1">
                  <DialogTitle>{t("styleOptimizeDialogTitle")}</DialogTitle>
                  <DialogDescription>
                    {t("styleOptimizeErrorDescription")}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="px-5 py-6">
              <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-3 text-sm text-destructive" role="alert">
                {error}
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t bg-muted/40 px-5 py-4 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("cancel")}
              </Button>
              <Button onClick={restart}>{t("styleOptimizeRetry")}</Button>
            </div>
          </>
        ) : (
          <div
            className="flex min-h-72 flex-col items-center justify-center gap-4 px-8 py-12 text-center"
            aria-live="polite"
          >
            <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <LoaderCircleIcon className="size-6 animate-spin" />
            </div>
            <div className="grid gap-1">
              <DialogTitle>{t("styleOptimizeGenerating")}</DialogTitle>
              <DialogDescription>
                {t("styleOptimizeGeneratingDescription")}
              </DialogDescription>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
