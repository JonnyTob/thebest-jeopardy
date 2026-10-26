import type { Round, Question } from '@shared/types';

export default function BoardGrid({
  round,
  answered,
  activeQuestionId,
  onOpenQuestion,
}: {
  round: Round;
  answered: Set<string>;
  activeQuestionId: string | null;
  onOpenQuestion: (q: Question) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${round.categories.length}, minmax(110px, 1fr))` }}
      >
        {/* Category headers */}
        {round.categories.map(cat => (
          <div key={cat.id} className="bg-jeopardy-blue border-2 border-black text-jeopardy-gold font-black text-center p-2 text-xs uppercase">
            {cat.name || 'CATEGORY'}
          </div>
        ))}
        {/* Question cells */}
        {round.pointValues.map(pv =>
          round.categories.map(cat => {
            const q = cat.questions.find(q => q.value === pv);
            if (!q) return <div key={`${cat.id}-${pv}`} />;
            const isAnswered = answered.has(q.id);
            const isActive = activeQuestionId === q.id;
            return (
              <button
                key={q.id}
                disabled={isAnswered}
                onClick={() => !isAnswered && onOpenQuestion(q)}
                className={`relative border-2 border-black text-center font-black py-3 text-sm transition-all
                  ${isActive ? 'bg-yellow-500 text-black border-yellow-300' :
                    isAnswered ? 'bg-gray-900 text-gray-700 cursor-not-allowed' :
                    'bg-jeopardy-blue text-jeopardy-gold hover:brightness-125'}`}
              >
                {isAnswered ? '—' : `$${pv}`}
                {q.isDailyDouble && !isAnswered && (
                  <span className="absolute top-1 right-1 bg-yellow-400 text-black text-[9px] font-black px-1 rounded leading-tight">DD</span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
