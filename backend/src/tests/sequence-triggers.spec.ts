/**
 * These tests pin shut the failure that made four of five live sequence steps do
 * nothing: the engine accepted five literal identifiers while the authoring UI offered a
 * free-text box, so everything an operator typed in their own words fell to a `default`
 * branch and returned false. Nothing in the product said so.
 *
 * Three properties are covered, in rough order of how expensive getting them wrong is:
 *   1. A prospect never receives two branches of the same step.
 *   2. The exact phrasings sitting in production resolve to the semantics intended.
 *   3. A condition the engine cannot read is reported, not dropped in silence.
 */
import { describe, it, expect, vi } from 'vitest';
import { SequenceService } from '../modules/engine/sequence.service';
import {
  TriggerCondition,
  classifyReply,
  conditionMatchesReply,
  isUnderstoodTriggerCondition,
  resolveTriggerCondition,
  selectBranch,
} from '../modules/engine/trigger-conditions';

/** The rows actually in the live database, verbatim. */
const PRODUCTION_ROWS = [
  { order: 0, raw: 'initial', expect: TriggerCondition.INITIAL },
  { order: 1, raw: 'after reply', expect: TriggerCondition.REPLIED_ANY },
  { order: 1, raw: 'If they say YES', expect: TriggerCondition.REPLIED_INTERESTED },
  {
    order: 1,
    raw: 'if they reply thankyou or anything',
    expect: TriggerCondition.REPLIED_NEUTRAL,
  },
  { order: 1, raw: 'If they say NO', expect: TriggerCondition.REPLIED_NOT_INTERESTED },
] as const;

describe('resolveTriggerCondition — the exact rows in production', () => {
  it.each(PRODUCTION_ROWS)(
    'reads $raw as $expect',
    ({ raw, expect: expected }) => {
      const resolved = resolveTriggerCondition(raw);
      expect(resolved.condition).toBe(expected);
      expect(resolved.matchedBy).not.toBe('unrecognised');
    },
  );

  it('leaves none of the production rows dead', () => {
    for (const row of PRODUCTION_ROWS) {
      expect(isUnderstoodTriggerCondition(row.raw)).toBe(true);
    }
  });

  it('still accepts every identifier the old switch handled', () => {
    for (const legacy of [
      'initial',
      'no_reply_48h',
      'no_reply_120h',
      'replied_interested',
      'replied_question',
    ]) {
      const resolved = resolveTriggerCondition(legacy);
      expect(resolved.matchedBy).toBe('canonical');
      expect(resolved.condition).toBe(legacy);
    }
  });
});

describe('resolveTriggerCondition — free text', () => {
  it.each([
    ['on reply', TriggerCondition.REPLIED_ANY],
    ['replied', TriggerCondition.REPLIED_ANY],
    ['when they respond', TriggerCondition.REPLIED_ANY],
    ['once they message back', TriggerCondition.REPLIED_ANY],
    ['if they are interested', TriggerCondition.REPLIED_INTERESTED],
    ['when they say yes', TriggerCondition.REPLIED_INTERESTED],
    ['they agreed', TriggerCondition.REPLIED_INTERESTED],
    ['not interested', TriggerCondition.REPLIED_NOT_INTERESTED],
    ['if they decline', TriggerCondition.REPLIED_NOT_INTERESTED],
    ['thanks', TriggerCondition.REPLIED_NEUTRAL],
    ['if they say ok', TriggerCondition.REPLIED_NEUTRAL],
    ['when they ask a question', TriggerCondition.REPLIED_QUESTION],
    ['if they enquire', TriggerCondition.REPLIED_QUESTION],
  ])('reads %s as %s', (raw, expected) => {
    expect(resolveTriggerCondition(raw).condition).toBe(expected);
  });

  it('reads silence phrasing as a no-reply rule, never as a reply rule', () => {
    // The dangerous direction: "if they do not reply" contains reply wording, and
    // reading it as an any-reply trigger would message the exact people excluded.
    for (const raw of [
      'if they do not reply',
      'no reply',
      'when there is no response',
      'never replied',
    ]) {
      const resolved = resolveTriggerCondition(raw);
      expect(resolved.condition).toBe(TriggerCondition.NO_REPLY_48H);
    }
  });

  it('honours an interval stated in free text rather than snapping to a preset', () => {
    expect(resolveTriggerCondition('no reply after 72 hours').hours).toBe(72);
    expect(resolveTriggerCondition('no reply after 3 days').hours).toBe(72);
    expect(resolveTriggerCondition('no response for 1 week').hours).toBe(168);
    // Five days or more is the existing 120h preset.
    expect(resolveTriggerCondition('no reply 5 days').condition).toBe(
      TriggerCondition.NO_REPLY_120H,
    );
  });

  it('prefers a refusal when a phrase carries both yes and no', () => {
    // Ambiguous input must not resolve to the branch that sells to someone saying no.
    expect(resolveTriggerCondition('if they say yes or no').condition).toBe(
      TriggerCondition.REPLIED_NOT_INTERESTED,
    );
  });

  it('treats an empty condition as the opening message, matching the column default', () => {
    for (const raw of ['', '   ', null, undefined]) {
      expect(resolveTriggerCondition(raw).condition).toBe(TriggerCondition.INITIAL);
    }
  });
});

describe('resolveTriggerCondition — unrecognised values', () => {
  it('reports rather than silently resolving to something plausible', () => {
    const resolved = resolveTriggerCondition('escalate to Ravi on Tuesday');
    expect(resolved.condition).toBeNull();
    expect(resolved.matchedBy).toBe('unrecognised');
    // The operator has to be able to see what was wrong with what they typed.
    expect(resolved.description).toContain('escalate to Ravi on Tuesday');
    expect(resolved.description).toMatch(/never send/i);
  });

  it('does not invent a condition out of unrelated words', () => {
    for (const raw of ['xyzzy', 'step two', 'follow the playbook', '42']) {
      expect(isUnderstoodTriggerCondition(raw)).toBe(false);
    }
  });
});

describe('classifyReply — sentiment from AI analysis, keywords as fallback', () => {
  it('prefers the AI classification over the words in the reply', () => {
    // The reply says "no" but the model read the whole conversation and scored it as
    // interested — "no, not March, but June works". Keyword matching gets this wrong.
    const signals = classifyReply({
      analysis: { intent: 'interested', interest_level: 'high', confidence: 0.9 },
      replyText: 'no, not March',
      hasReplied: true,
    });
    expect(signals.source).toBe('ai_analysis');
    expect(signals.sentiment).toBe('interested');
  });

  it('falls back to keywords when there is no analysis', () => {
    const signals = classifyReply({ analysis: null, replyText: 'Yes please!', hasReplied: true });
    expect(signals.source).toBe('keywords');
    expect(signals.sentiment).toBe('interested');
  });

  it('falls back to keywords when the model was not confident enough', () => {
    const signals = classifyReply({
      analysis: { intent: 'interested', interest_level: 'high', confidence: 0.2 },
      replyText: 'not interested, thanks',
      hasReplied: true,
    });
    expect(signals.source).toBe('keywords');
    expect(signals.sentiment).toBe('not_interested');
  });

  it('never reads an opt-out as interest, whatever the interest score says', () => {
    const signals = classifyReply({
      analysis: { intent: 'opt_out', interest_level: 'high', confidence: 0.95, opt_out: true },
      hasReplied: true,
    });
    expect(signals.sentiment).toBe('not_interested');
  });

  it('treats a question as independent of sentiment', () => {
    const signals = classifyReply({
      analysis: {
        intent: 'question',
        interest_level: 'high',
        confidence: 0.85,
        questions: ['What does it cost?'],
      },
      hasReplied: true,
    });
    // Both branches must stay reachable: an eager prospect can also be asking something.
    expect(signals.sentiment).toBe('interested');
    expect(signals.isQuestion).toBe(true);
  });

  it('reads an acknowledgement as neutral rather than as a refusal', () => {
    for (const text of ['thankyou', 'thanks!', 'ok noted', 'no problem']) {
      const signals = classifyReply({ analysis: null, replyText: text, hasReplied: true });
      expect(signals.sentiment).toBe('neutral');
    }
  });

  it('keeps every reply-triggered condition shut when there is no reply', () => {
    const signals = classifyReply({ hasReplied: false });
    expect(signals.replied).toBe(false);
    for (const condition of [
      TriggerCondition.REPLIED_ANY,
      TriggerCondition.REPLIED_INTERESTED,
      TriggerCondition.REPLIED_NOT_INTERESTED,
      TriggerCondition.REPLIED_NEUTRAL,
      TriggerCondition.REPLIED_QUESTION,
    ]) {
      expect(conditionMatchesReply(condition, signals)).toBe(false);
    }
  });

  it('treats an unclassifiable reply as neutral, not as a refusal', () => {
    // Reading meaninglessness as a no would suppress the wrong branch.
    const signals = classifyReply({ analysis: null, replyText: '👍', hasReplied: true });
    expect(signals.sentiment).toBe('neutral');
    expect(signals.replied).toBe(true);
  });
});

describe('selectBranch — exactly one template per step', () => {
  /** The live step-1 fan-out: a yes branch, a no branch and an acknowledgement branch. */
  const branches = [
    { id: 't-yes', name: 'Yes branch', sequence_order: 1, trigger_condition: 'If they say YES' },
    { id: 't-no', name: 'No branch', sequence_order: 1, trigger_condition: 'If they say NO' },
    {
      id: 't-thanks',
      name: 'Thanks branch',
      sequence_order: 1,
      trigger_condition: 'if they reply thankyou or anything',
    },
    { id: 't-any', name: 'Any branch', sequence_order: 1, trigger_condition: 'after reply' },
  ];

  const signalsFor = (interest: string, intent = 'interested') =>
    classifyReply({
      analysis: { intent, interest_level: interest, confidence: 0.9 },
      hasReplied: true,
    });

  it('picks the yes branch for an interested reply', () => {
    const { chosen } = selectBranch(branches, signalsFor('high'));
    expect(chosen?.id).toBe('t-yes');
  });

  it('picks the no branch for a refusal', () => {
    const { chosen } = selectBranch(branches, signalsFor('none', 'not_interested'));
    expect(chosen?.id).toBe('t-no');
  });

  it('picks the acknowledgement branch for a neutral reply', () => {
    const { chosen } = selectBranch(branches, signalsFor('low', 'greeting'));
    expect(chosen?.id).toBe('t-thanks');
  });

  it('never returns more than one branch even when several match', () => {
    // An interested reply satisfies both the yes branch and the any-reply branch.
    const signals = signalsFor('high');
    const { chosen, considered } = selectBranch(branches, signals);
    expect(considered.filter((c) => c.matched).length).toBeGreaterThan(1);
    expect(chosen).not.toBeNull();
    // One winner, and it is the specific branch rather than the catch-all.
    expect(chosen?.id).toBe('t-yes');
  });

  it('falls back to the any-reply branch when no sentiment branch fits', () => {
    const onlyAny = [
      { id: 't-any', name: 'Any', sequence_order: 1, trigger_condition: 'after reply' },
      { id: 't-yes', name: 'Yes', sequence_order: 1, trigger_condition: 'If they say YES' },
    ];
    const { chosen } = selectBranch(onlyAny, signalsFor('none', 'greeting'));
    expect(chosen?.id).toBe('t-any');
  });

  it('is deterministic when two equally specific branches tie', () => {
    const duplicated = [
      { id: 't-b', name: 'B', sequence_order: 1, trigger_condition: 'yes' },
      { id: 't-a', name: 'A', sequence_order: 1, trigger_condition: 'if they say yes' },
    ];
    // Stable across processes and independent of the order the database returned rows,
    // so a retry cannot pick the other branch and send a second message.
    const first = selectBranch(duplicated, signalsFor('high')).chosen;
    const second = selectBranch(duplicated.slice().reverse(), signalsFor('high')).chosen;
    expect(first?.id).toBe('t-a');
    expect(second?.id).toBe('t-a');
  });

  it('ignores unrecognised branches instead of letting them win', () => {
    const withJunk = [
      { id: 't-junk', name: 'Junk', sequence_order: 1, trigger_condition: 'ping Ravi' },
      { id: 't-yes', name: 'Yes', sequence_order: 1, trigger_condition: 'If they say YES' },
    ];
    const { chosen, considered } = selectBranch(withJunk, signalsFor('high'));
    expect(chosen?.id).toBe('t-yes');
    expect(considered.find((c) => c.template.id === 't-junk')?.resolution.matchedBy).toBe(
      'unrecognised',
    );
  });

  it('chooses nothing when the contact has not replied', () => {
    const { chosen } = selectBranch(branches, classifyReply({ hasReplied: false }));
    expect(chosen).toBeNull();
  });
});

/**
 * Build the service with controllable collaborators. `claimed` is shared so a second
 * call sees the first call's Redis claim, which is how the duplicate-send guard works.
 */
function makeService(
  over: {
    templates?: any[];
    cc?: any;
    analysis?: any;
    lastInbound?: any;
    sentMessages?: any[];
    claimed?: Set<string>;
  } = {},
) {
  const templates = over.templates ?? [];
  const claimed = over.claimed ?? new Set<string>();
  const sentMessages = over.sentMessages ?? [];

  const cc = over.cc ?? {
    id: 'cc1',
    campaign_id: 'camp-1',
    contact_id: 'contact-1',
    current_sequence_step: 1,
    mode: 'ai',
    last_sent_at: new Date(Date.now() - 60 * 60 * 1000),
    last_reply_at: new Date(),
    contact: { is_opted_out: false, is_suppressed: false },
    campaign: { status: 'active', openwa_session_id: 'sess-1' },
  };

  const ccRepo = { findOne: vi.fn(async () => cc), update: vi.fn(async () => ({})) };

  const templateRepo = {
    find: vi.fn(async ({ where }: any) =>
      templates.filter(
        (t) =>
          t.campaign_id === where.campaign_id &&
          // The campaign-wide query omits sequence_order; the per-step one pins it.
          (where.sequence_order === undefined || t.sequence_order === where.sequence_order),
      ),
    ),
    findOne: vi.fn(async () => null),
  };

  const messageRepo = {
    findOne: vi.fn(async ({ where }: any) => {
      if (where?.direction === 'incoming') return over.lastInbound ?? null;
      // `where.template_id` is a TypeORM In(...) operator; read the ids out of it
      // without depending on which internal field holds them.
      const op = where?.template_id;
      const ids: string[] = Array.isArray(op?._value)
        ? op._value
        : Array.isArray(op?.value)
          ? op.value
          : [];
      return sentMessages.find((m) => ids.includes(m.template_id)) ?? null;
    }),
  };

  const analysisRepo = { findOne: vi.fn(async () => over.analysis ?? null) };
  const campaignRepo = { findOne: vi.fn(async () => cc.campaign), increment: vi.fn() };
  const sendQueue = { add: vi.fn(async () => ({ id: 'job-1' })) };

  const redis = {
    // Mirrors RedisService.isDuplicate: true means the key already existed.
    isDuplicate: vi.fn(async (key: string) => {
      if (claimed.has(key)) return true;
      claimed.add(key);
      return false;
    }),
  };

  const svc = new SequenceService(
    ccRepo as any,
    templateRepo as any,
    messageRepo as any,
    analysisRepo as any,
    campaignRepo as any,
    sendQueue as any,
    redis as any,
  );

  return { svc, cc, ccRepo, templateRepo, messageRepo, sendQueue, redis, claimed };
}

/** The live step-1 fan-out, as rows. */
const LIVE_STEP_1 = [
  {
    id: 't-yes',
    name: 'Yes branch',
    campaign_id: 'camp-1',
    sequence_order: 1,
    trigger_condition: 'If they say YES',
  },
  {
    id: 't-no',
    name: 'No branch',
    campaign_id: 'camp-1',
    sequence_order: 1,
    trigger_condition: 'If they say NO',
  },
  {
    id: 't-thanks',
    name: 'Thanks branch',
    campaign_id: 'camp-1',
    sequence_order: 1,
    trigger_condition: 'if they reply thankyou or anything',
  },
  {
    id: 't-any',
    name: 'Any branch',
    campaign_id: 'camp-1',
    sequence_order: 1,
    trigger_condition: 'after reply',
  },
];

const interestedAnalysis = {
  intent: 'interested',
  interest_level: 'high',
  confidence: 0.9,
  opt_out: false,
  questions: [],
};

describe('SequenceService.onAiAnalysisComplete — branching', () => {
  it('fires the yes branch for an interested reply, and only that branch', async () => {
    const ctx = makeService({ templates: LIVE_STEP_1 });

    const queued = await ctx.svc.onAiAnalysisComplete('cc1', interestedAnalysis as any);

    expect(queued).toBe(true);
    expect(ctx.sendQueue.add).toHaveBeenCalledTimes(1);
    expect(ctx.sendQueue.add.mock.calls[0][1]).toMatchObject({ templateId: 't-yes' });
  });

  it('fires the no branch for a refusal', async () => {
    const ctx = makeService({ templates: LIVE_STEP_1 });

    await ctx.svc.onAiAnalysisComplete('cc1', {
      intent: 'not_interested',
      interest_level: 'none',
      confidence: 0.9,
    } as any);

    expect(ctx.sendQueue.add.mock.calls[0][1]).toMatchObject({ templateId: 't-no' });
  });

  it('fires the acknowledgement branch for a plain thank-you', async () => {
    const ctx = makeService({ templates: LIVE_STEP_1 });

    await ctx.svc.onAiAnalysisComplete(
      'cc1',
      { intent: 'acknowledgement', interest_level: 'low', confidence: 0.8 } as any,
      'thankyou',
    );

    expect(ctx.sendQueue.add.mock.calls[0][1]).toMatchObject({ templateId: 't-thanks' });
  });

  it('never sends two branches to the same contact for the same step', async () => {
    const ctx = makeService({ templates: LIVE_STEP_1 });

    // Two triggers for the same step: a redelivered analysis, or the webhook path and
    // the worker racing. Exactly one send may result.
    const first = await ctx.svc.onAiAnalysisComplete('cc1', interestedAnalysis as any);
    const second = await ctx.svc.onAiAnalysisComplete('cc1', interestedAnalysis as any);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(ctx.sendQueue.add).toHaveBeenCalledTimes(1);
  });

  it('does not send again when this step already produced a message and Redis is down', async () => {
    const ctx = makeService({
      templates: LIVE_STEP_1,
      // A send for this step is already in the database.
      sentMessages: [{ template_id: 't-yes', direction: 'outgoing' }],
    });
    // Redis unavailable: isDuplicate fails open, so the database check is the only guard.
    ctx.redis.isDuplicate = vi.fn(async () => false);

    const queued = await ctx.svc.onAiAnalysisComplete('cc1', interestedAnalysis as any);

    expect(queued).toBe(false);
    expect(ctx.sendQueue.add).not.toHaveBeenCalled();
  });

  it('stays silent when a human has taken over', async () => {
    const ctx = makeService({
      templates: LIVE_STEP_1,
      cc: {
        id: 'cc1',
        campaign_id: 'camp-1',
        contact_id: 'contact-1',
        current_sequence_step: 1,
        mode: 'human',
        contact: { is_opted_out: false, is_suppressed: false },
        campaign: { status: 'active' },
      },
    });

    expect(await ctx.svc.onAiAnalysisComplete('cc1', interestedAnalysis as any)).toBe(false);
    expect(ctx.sendQueue.add).not.toHaveBeenCalled();
  });

  it('stays silent for an opted-out or suppressed contact', async () => {
    for (const flags of [
      { is_opted_out: true, is_suppressed: false },
      { is_opted_out: false, is_suppressed: true },
    ]) {
      const ctx = makeService({
        templates: LIVE_STEP_1,
        cc: {
          id: 'cc1',
          campaign_id: 'camp-1',
          contact_id: 'contact-1',
          current_sequence_step: 1,
          mode: 'ai',
          contact: flags,
          campaign: { status: 'active' },
        },
      });

      expect(await ctx.svc.onAiAnalysisComplete('cc1', interestedAnalysis as any)).toBe(false);
      expect(ctx.sendQueue.add).not.toHaveBeenCalled();
    }
  });

  it('logs an unrecognised condition rather than dropping the step in silence', async () => {
    const ctx = makeService({
      templates: [
        {
          id: 't-junk',
          name: 'Mystery step',
          campaign_id: 'camp-1',
          sequence_order: 1,
          trigger_condition: 'escalate to Ravi on Tuesday',
        },
      ],
    });

    const warn = vi.spyOn((ctx.svc as any).logger, 'warn');

    const queued = await ctx.svc.onAiAnalysisComplete('cc1', interestedAnalysis as any);

    expect(queued).toBe(false);
    expect(ctx.sendQueue.add).not.toHaveBeenCalled();
    // The whole point: the operator can find out this step is dead.
    expect(warn).toHaveBeenCalled();
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('escalate to Ravi on Tuesday');
    expect(logged).toContain('Mystery step');
  });

  it('still reaches a reply branch that sits above a time-based step', async () => {
    // The shape the old forward scan supported: step 1 waits for silence, step 2 answers
    // a reply. A contact who replies at step 1 must still reach step 2's branch.
    const ctx = makeService({
      templates: [
        {
          id: 't-nudge',
          name: 'Nudge',
          campaign_id: 'camp-1',
          sequence_order: 1,
          trigger_condition: 'no_reply_48h',
        },
        {
          id: 't-warm',
          name: 'Warm reply',
          campaign_id: 'camp-1',
          sequence_order: 2,
          trigger_condition: 'replied_interested',
        },
      ],
    });

    expect(await ctx.svc.onAiAnalysisComplete('cc1', interestedAnalysis as any)).toBe(true);
    expect(ctx.sendQueue.add.mock.calls[0][1]).toMatchObject({ templateId: 't-warm' });
  });

  it('does not skip past a reply step whose branches all failed to match', async () => {
    // Step 1 has reply branches but none fit a refusal, so nothing sends. Scanning on to
    // step 2 would let a reply jump a step it did not satisfy.
    const ctx = makeService({
      templates: [
        {
          id: 't-yes',
          name: 'Yes only',
          campaign_id: 'camp-1',
          sequence_order: 1,
          trigger_condition: 'If they say YES',
        },
        {
          id: 't-later',
          name: 'Later step',
          campaign_id: 'camp-1',
          sequence_order: 2,
          trigger_condition: 'after reply',
        },
      ],
    });

    const queued = await ctx.svc.onAiAnalysisComplete('cc1', {
      intent: 'not_interested',
      interest_level: 'none',
      confidence: 0.9,
    } as any);

    expect(queued).toBe(false);
    expect(ctx.sendQueue.add).not.toHaveBeenCalled();
  });
});

describe('SequenceService.evaluateCondition', () => {
  const ccWithReply = {
    id: 'cc1',
    campaign_id: 'camp-1',
    last_sent_at: new Date(Date.now() - 60 * 60 * 1000),
    last_reply_at: new Date(),
  } as any;

  it('fires every production phrasing against a matching reply', async () => {
    const ctx = makeService({ analysis: interestedAnalysis });

    expect(await ctx.svc.evaluateCondition('after reply', ccWithReply)).toBe(true);
    expect(await ctx.svc.evaluateCondition('If they say YES', ccWithReply)).toBe(true);
    expect(await ctx.svc.evaluateCondition('If they say NO', ccWithReply)).toBe(false);
  });

  it('still answers the legacy identifiers exactly as before', async () => {
    const ctx = makeService({ analysis: interestedAnalysis });

    expect(await ctx.svc.evaluateCondition('initial', ccWithReply)).toBe(true);
    expect(await ctx.svc.evaluateCondition('replied_interested', ccWithReply)).toBe(true);
    // A contact who replied can never satisfy a no-reply rule.
    expect(await ctx.svc.evaluateCondition('no_reply_48h', ccWithReply)).toBe(false);
  });

  it('honours a free-text interval on the no-reply family', async () => {
    const ctx = makeService();
    const silent = {
      id: 'cc1',
      campaign_id: 'camp-1',
      last_sent_at: new Date(Date.now() - 80 * 60 * 60 * 1000),
      last_reply_at: null,
    } as any;

    expect(await ctx.svc.evaluateCondition('no reply after 72 hours', silent)).toBe(true);
    expect(await ctx.svc.evaluateCondition('no reply after 5 days', silent)).toBe(false);
  });

  it('returns false and warns for a condition it cannot read', async () => {
    const ctx = makeService();
    const warn = vi.spyOn((ctx.svc as any).logger, 'warn');

    expect(await ctx.svc.evaluateCondition('do the needful', ccWithReply)).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('do the needful');
  });
});

describe('SequenceService.advanceSequence', () => {
  it('picks one branch from a step that has several', async () => {
    const ctx = makeService({ templates: LIVE_STEP_1, analysis: interestedAnalysis });

    expect(await ctx.svc.advanceSequence('cc1')).toBe(true);
    expect(ctx.sendQueue.add).toHaveBeenCalledTimes(1);
    expect(ctx.sendQueue.add.mock.calls[0][1]).toMatchObject({ templateId: 't-yes' });
  });

  it('will not queue a second branch for a step it already queued', async () => {
    const ctx = makeService({ templates: LIVE_STEP_1, analysis: interestedAnalysis });

    await ctx.svc.advanceSequence('cc1');
    const again = await ctx.svc.advanceSequence('cc1');

    expect(again).toBe(false);
    expect(ctx.sendQueue.add).toHaveBeenCalledTimes(1);
  });

  it('shares the step claim with the reply-triggered path', async () => {
    // Both entry points can fire for the same step; only one send may reach the prospect.
    const claimed = new Set<string>();
    const first = makeService({ templates: LIVE_STEP_1, analysis: interestedAnalysis, claimed });
    const second = makeService({ templates: LIVE_STEP_1, analysis: interestedAnalysis, claimed });

    expect(await first.svc.onAiAnalysisComplete('cc1', interestedAnalysis as any)).toBe(true);
    expect(await second.svc.advanceSequence('cc1')).toBe(false);
    expect(second.sendQueue.add).not.toHaveBeenCalled();
  });

  it('fires a no-reply step for a contact who has gone quiet', async () => {
    const ctx = makeService({
      templates: [
        {
          id: 't-nudge',
          name: 'Nudge',
          campaign_id: 'camp-1',
          sequence_order: 1,
          trigger_condition: 'if they do not reply in 48 hours',
        },
      ],
      cc: {
        id: 'cc1',
        campaign_id: 'camp-1',
        contact_id: 'contact-1',
        current_sequence_step: 1,
        mode: 'ai',
        last_sent_at: new Date(Date.now() - 60 * 60 * 60 * 1000),
        last_reply_at: null,
        contact: { is_opted_out: false, is_suppressed: false },
        campaign: { status: 'active', openwa_session_id: 'sess-1' },
      },
    });

    expect(await ctx.svc.advanceSequence('cc1')).toBe(true);
    expect(ctx.sendQueue.add.mock.calls[0][1]).toMatchObject({ templateId: 't-nudge' });
  });

  it('keeps every existing suppression check', async () => {
    for (const cc of [
      { mode: 'human', contact: { is_opted_out: false, is_suppressed: false }, campaign: { status: 'active' } },
      { mode: 'ai', contact: { is_opted_out: true, is_suppressed: false }, campaign: { status: 'active' } },
      { mode: 'ai', contact: { is_opted_out: false, is_suppressed: true }, campaign: { status: 'active' } },
      { mode: 'ai', contact: { is_opted_out: false, is_suppressed: false }, campaign: { status: 'paused' } },
    ]) {
      const ctx = makeService({
        templates: LIVE_STEP_1,
        analysis: interestedAnalysis,
        cc: {
          id: 'cc1',
          campaign_id: 'camp-1',
          contact_id: 'contact-1',
          current_sequence_step: 1,
          last_reply_at: new Date(),
          ...cc,
        },
      });

      expect(await ctx.svc.advanceSequence('cc1')).toBe(false);
      expect(ctx.sendQueue.add).not.toHaveBeenCalled();
    }
  });
});
