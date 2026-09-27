import { useEffect, useMemo, useRef, useState } from 'react';
import { AutoComplete, Flex, Typography } from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import {
  engineAPI,
  type TriggerConditionCheck,
  type TriggerConditionOption,
} from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

/**
 * Trigger-condition picker for a sequence step.
 *
 * Replaces a plain text input whose placeholder ("e.g. no_reply_24h") invited operators
 * to describe the condition in their own words. The engine accepted five literals, so
 * anything else was accepted by the form, stored, displayed as configured — and never
 * fired. Four of five live steps were dead that way.
 *
 * The supported conditions are therefore the primary path and come from the engine
 * itself. Free text stays possible, because operators do express conditions the list has
 * not anticipated and blocking them outright loses that information, but it is never
 * silent: every value is checked against the engine and the result is stated in words
 * next to the field. An unreadable condition is a visible warning before the template is
 * saved rather than a message that never sends.
 */
export default function TriggerConditionField({
  value,
  onChange,
}: {
  value?: string;
  onChange?: (next: string) => void;
}) {
  const [options, setOptions] = useState<TriggerConditionOption[]>([]);
  const [check, setCheck] = useState<TriggerConditionCheck | null>(null);
  const [checking, setChecking] = useState(false);
  /** Guards against an earlier, slower check overwriting a later one. */
  const latestRequest = useRef(0);

  useEffect(() => {
    let live = true;
    engineAPI
      .getTriggerConditions()
      .then((res) => {
        if (live) setOptions(res.data?.conditions ?? []);
      })
      // A failed list must not block authoring: the field still accepts text and the
      // engine still validates on save.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const known = useMemo(
    () => new Set(options.map((o) => o.value)),
    [options],
  );

  useEffect(() => {
    const raw = (value ?? '').trim();
    if (!raw) {
      setCheck(null);
      setChecking(false);
      return;
    }

    // A canonical value needs no round trip — it is by definition understood, and the
    // label is already to hand.
    const exact = options.find((o) => o.value === raw);
    if (exact) {
      setCheck({
        raw,
        understood: true,
        condition: exact.value,
        matched_by: 'canonical',
        description: exact.description,
      });
      setChecking(false);
      return;
    }

    // Debounced so typing does not fire a request per keystroke.
    const requestId = ++latestRequest.current;
    setChecking(true);
    const timer = window.setTimeout(() => {
      engineAPI
        .checkTriggerCondition(raw)
        .then((res) => {
          if (latestRequest.current !== requestId) return;
          setCheck(res.data?.check ?? null);
        })
        .catch(() => {
          if (latestRequest.current === requestId) setCheck(null);
        })
        .finally(() => {
          if (latestRequest.current === requestId) setChecking(false);
        });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [value, options]);

  const autoCompleteOptions = options.map((o) => ({
    value: o.value,
    label: (
      <Flex vertical gap={2}>
        <Text style={{ fontSize: font.size.body }}>{o.label}</Text>
        <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
          {o.description}
        </Text>
      </Flex>
    ),
  }));

  return (
    <Flex vertical gap={space.sm}>
      <AutoComplete
        id="template-trigger-condition"
        aria-label="Trigger condition — when this step sends"
        aria-describedby="template-trigger-condition-status"
        value={value}
        onChange={(next) => onChange?.(next ?? '')}
        options={autoCompleteOptions}
        // Matches on the human label as well as the identifier, so an operator can type
        // "yes" and find "When they say yes / show interest".
        filterOption={(input, option) => {
          const needle = input.trim().toLowerCase();
          if (!needle) return true;
          const candidate = options.find((o) => o.value === option?.value);
          return (
            String(option?.value ?? '').toLowerCase().includes(needle) ||
            (candidate?.label ?? '').toLowerCase().includes(needle) ||
            (candidate?.description ?? '').toLowerCase().includes(needle)
          );
        }}
        placeholder="Choose when this step sends"
        style={{ width: '100%' }}
      />

      <TriggerConditionStatus check={check} checking={checking} isCanonical={known.has((value ?? '').trim())} />
    </Flex>
  );
}

/**
 * Says in words what the engine will do with the current value.
 *
 * Always rendered, including the empty case, so the field never looks merely unfilled
 * when it is in fact broken. Status is carried by an icon and a sentence, not by colour
 * alone.
 */
function TriggerConditionStatus({
  check,
  checking,
  isCanonical,
}: {
  check: TriggerConditionCheck | null;
  checking: boolean;
  isCanonical: boolean;
}) {
  const shared = {
    id: 'template-trigger-condition-status',
    role: 'status' as const,
    'aria-live': 'polite' as const,
    style: {
      background: color.fill,
      borderRadius: radius.md,
      padding: `${space.sm}px ${space.md}px`,
    },
  };

  if (checking) {
    return (
      <Flex {...shared} align="center" gap={space.sm}>
        <LoadingOutlined style={{ color: color.textSecondary }} />
        <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
          Checking what this means…
        </Text>
      </Flex>
    );
  }

  if (!check) {
    return (
      <Flex {...shared} align="center" gap={space.sm}>
        <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
          Leave blank to send this step immediately as the opening message.
        </Text>
      </Flex>
    );
  }

  if (!check.understood) {
    return (
      <Flex
        {...shared}
        align="flex-start"
        gap={space.sm}
        style={{ ...shared.style, background: color.dangerSoft }}
      >
        <ExclamationCircleOutlined style={{ color: color.danger, marginTop: 2 }} />
        <Text style={{ fontSize: font.size.caption, color: color.danger }}>
          Not understood — this step would never send. Pick one of the listed conditions
          instead.
        </Text>
      </Flex>
    );
  }

  return (
    <Flex
      {...shared}
      align="flex-start"
      gap={space.sm}
      style={{ ...shared.style, background: color.successSoft }}
    >
      <CheckCircleOutlined style={{ color: color.success, marginTop: 2 }} />
      <Flex vertical gap={2}>
        <Text style={{ fontSize: font.size.caption, color: color.success }}>
          {check.description}.
        </Text>
        {/* Spelled out when free text was interpreted: the operator should know their
            wording was mapped onto a rule, and onto which one. */}
        {!isCanonical && check.matched_by === 'phrase' && (
          <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
            Read as “{check.condition}”.
          </Text>
        )}
      </Flex>
    </Flex>
  );
}
