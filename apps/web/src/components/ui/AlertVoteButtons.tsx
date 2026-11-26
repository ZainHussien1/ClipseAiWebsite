import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { voteAlert } from '../../lib/api-v1';
import type { AlertItem } from '../../lib/contracts';

interface AlertVoteButtonsProps {
  alertId: string;
  userVote: boolean | null;
}

export function AlertVoteButtons({ alertId, userVote }: AlertVoteButtonsProps) {
  const queryClient = useQueryClient();

  const voteMutation = useMutation({
    mutationFn: (useful: boolean) => voteAlert(alertId, useful),
    onMutate: async (useful) => {
      await queryClient.cancelQueries({ queryKey: ['alerts'] });
      const previous = queryClient.getQueryData<AlertItem[]>(['alerts']);
      queryClient.setQueryData<AlertItem[]>(['alerts'], (old) =>
        old ? old.map((a) => (a.id === alertId ? { ...a, userVote: useful } : a)) : old,
      );
      return { previous };
    },
    onError: (_err, _useful, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['alerts'], ctx.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => voteMutation.mutate(true)}
        aria-label="Mark alert useful"
        aria-pressed={userVote === true}
        className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium ${
          userVote === true
            ? 'border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)]'
            : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
      >
        <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.5} />
        Useful
      </button>
      <button
        type="button"
        onClick={() => voteMutation.mutate(false)}
        aria-label="Mark alert not useful"
        aria-pressed={userVote === false}
        className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium ${
          userVote === false
            ? 'border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]'
            : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
      >
        <ThumbsDown className="h-3.5 w-3.5" strokeWidth={1.5} />
        Not useful
      </button>
    </div>
  );
}
