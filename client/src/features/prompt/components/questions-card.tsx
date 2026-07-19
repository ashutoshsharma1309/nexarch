import { MessageCircleQuestion } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Card, CardContent } from '@/shared/components/ui/card';

export interface QuestionsCardProps {
  questions: string[];
  projectType: string | null;
  /** Focus the prompt textarea so the user can refine immediately. */
  onRefine: () => void;
}

/**
 * Rendered when analysis returns INCOMPLETE: the prompt was understood but
 * is too thin to specify safely, so the analyzer asks instead of guessing.
 */
export function QuestionsCard({ questions, projectType, onRefine }: QuestionsCardProps) {
  return (
    <Card className="border-accent/30">
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-fg">A few details are missing</h3>
              {projectType && <Badge variant="accent">{projectType} detected</Badge>}
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              Add answers to your description and analyze again — the spec will be built from
              exactly what you say.
            </p>
            <ol className="mt-3 space-y-2">
              {questions.map((question, index) => (
                <li key={question} className="flex gap-2.5 text-[0.8125rem] text-fg">
                  <span className="font-mono text-xs text-fg-subtle">{index + 1}.</span>
                  {question}
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={onRefine}
              className="mt-4 text-[0.8125rem] font-medium text-accent hover:text-accent-hover"
            >
              Refine description
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
