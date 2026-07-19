import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { MoveUp, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ReminderPayload = {
  message: string;
  duration_ms: number;
  dim_opacity: number;
  is_test: boolean;
};

const initialPayload: ReminderPayload = {
  message: 'Gently reset your posture',
  duration_ms: 8000,
  dim_opacity: 0.34,
  is_test: false,
};

const ReminderSurface = ({ kind }: { kind: 'reminder' | 'dim' }) => {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<ReminderPayload>(initialPayload);
  const [sequence, setSequence] = useState(0);

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';

    const unlisten = listen<ReminderPayload>('reliable-reminder', (event) => {
      setPayload(event.payload);
      setSequence((value) => value + 1);
    });

    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const dismiss = () => {
    void invoke('dismiss_reminder_surfaces');
  };

  if (kind === 'dim') {
    return (
      <main
        key={sequence}
        className="h-screen w-screen flex items-center justify-center animate-in fade-in duration-500"
        style={{ backgroundColor: `rgba(9, 25, 21, ${payload.dim_opacity})` }}
        aria-live="assertive"
        aria-label={payload.message}
      >
        <div className="flex items-center gap-3 rounded-full border border-white/20 bg-[#0c2b22]/82 px-5 py-3 text-sm font-medium text-white shadow-2xl backdrop-blur-xl">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#f1cf78] text-[#173e32]"><MoveUp className="h-4 w-4" /></span>
          <span>{payload.message}</span>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen w-screen p-2" aria-live="assertive">
      <section
        key={sequence}
        className="relative flex h-full items-center gap-4 overflow-hidden rounded-[24px] border border-white/55 bg-[#fffdf5]/96 px-5 text-[#173e32] shadow-[0_18px_55px_rgba(18,55,44,0.28)] backdrop-blur-xl animate-in slide-in-from-top-4 fade-in duration-300"
      >
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#e16d55]" />
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-[#dcebe3] text-[#1d634e] ring-1 ring-[#2f7d66]/15">
          <MoveUp className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#34725e]">
            {payload.is_test ? t('reminder.testLabel', 'OnePosture · Test') : t('reminder.alertLabel', 'OnePosture · Gentle reset')}
          </p>
          <p className="mt-1 truncate text-[15px] font-semibold">{payload.message}</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#557069] transition-colors hover:bg-[#e4efeb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f7d66]"
          aria-label={t('reminder.dismiss', 'Dismiss reminder')}
        >
          <X className="h-4 w-4" />
        </button>
      </section>
    </main>
  );
};

export default ReminderSurface;
