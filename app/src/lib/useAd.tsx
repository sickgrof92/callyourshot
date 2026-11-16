// One place that plays an ad for any purpose (points, pick, forfeit) and
// resolves with the completed session id, or null if the ad wasn't finished.
import { useCallback, useRef, useState, type ReactElement } from 'react';
import { StubAdModal } from '../components/StubAdModal';
import { api, type AdPurpose } from './api';
import { showRewardedAd } from './rewardedAd';
import { useSession } from './session';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useAd(): { watch: (purpose: AdPurpose) => Promise<string | null>; adModal: ReactElement } {
  const { token, me } = useSession();
  const [stubVisible, setStubVisible] = useState(false);
  const stubDone = useRef<((completed: boolean) => void) | null>(null);

  const watch = useCallback(
    async (purpose: AdPurpose): Promise<string | null> => {
      if (!token || !me) return null;
      // Errors (e.g. not allowed to earn points right now) propagate to the caller.
      const session = await api.startAd(token, purpose);
      if (session.provider === 'stub') {
        const completed = await new Promise<boolean>((resolve) => {
          stubDone.current = resolve;
          setStubVisible(true);
        });
        if (!completed) return null;
        await api.completeStubAd(token, session.sessionId);
        return session.sessionId;
      }
      const earned = await showRewardedAd(session.sessionId, me.id);
      if (!earned) return null;
      // The ad network confirms the view to our server directly; wait for it.
      for (let i = 0; i < 10; i++) {
        if ((await api.adStatus(token, session.sessionId)).rewarded) return session.sessionId;
        await sleep(1500);
      }
      throw new Error('ad_not_confirmed');
    },
    [token, me],
  );

  const adModal = (
    <StubAdModal
      visible={stubVisible}
      onFinish={(completed) => {
        setStubVisible(false);
        stubDone.current?.(completed);
        stubDone.current = null;
      }}
    />
  );
  return { watch, adModal };
}
