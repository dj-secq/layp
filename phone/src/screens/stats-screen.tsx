import { Centered, ScreenScroll } from "@/components/screen";
import { completionsBetween, sessionMinutesBetween } from "@/db/focus";
import { daysBetween, loadTrackers, logsBetween } from "@/db/journal";
import { usePhone } from "@/state/phone";
import { colors, onPrimary, primary } from "@/theme/colors";
import { usePaper } from "@/theme/theme";
import { averageSleep, daysAround, formatHours, todayIso, type DayReading } from "@layp/shared";
import { Redirect } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View, type ScrollViewInstance } from "react-native";
import { axisLabels, buildBoard, chartSeries, columnHead, type Board, type Mark } from "../stats/board";
import { LaypTitle } from "@/components/layp-title";

const RANGES = [7, 28, 365] as const;
const VIEWS = ["days", "bars", "line"] as const;
type StatsView = (typeof VIEWS)[number];
const VIEW_LABELS: Record<StatsView, string> = { days: "Days", bars: "Bars", line: "Line" };
const READING_LABEL: Record<DayReading, string> = { down: "Down", productive: "Productive", quiet: "Quiet" };
const READING_COLOR: Record<DayReading, string> = { down: "#ff6b6b", productive: "#86efac", quiet: "#d6d3d1" };
const TASK_COLOR = "#ffdc58";
const FOCUS_COLOR = "#7dd3fc";
const SLEEP_COLOR = "#93c5fd";

export function StatsScreen() {
  usePaper();
  const phone = usePhone();
  const today = todayIso();
  const [span, setSpan] = useState<(typeof RANGES)[number]>(7);
  const [view, setView] = useState<StatsView>("days");
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const scroller = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    if (!phone.ready || !phone.hasKey) return;
    let cancel = false;
    const days = daysAround(today, span);
    const from = days[0] ?? today;
    const to = days[days.length - 1] ?? today;
    void Promise.all([
      completionsBetween(from, to),
      sessionMinutesBetween(from, to),
      daysBetween(from, to),
      loadTrackers(false),
      logsBetween(from, to),
    ]).then(
      ([completedDays, sessions, snaps, trackers, logs]) => {
        if (cancel) return;
        setBoard(buildBoard({ today, days, span, completedDays, sessions, snaps, trackers, logs, muted: colors.secondaryLabel }));
        setError(null);
      },
      () => {
        if (!cancel) setError("Could not load stats.");
      },
    );
    return () => {
      cancel = true;
    };
  }, [phone.ready, phone.hasKey, phone.revision, span, today, retry]);

  useEffect(() => {
    if (view !== "days" || !board) return;
    const index = board.days.indexOf(today);
    if (index < 0) return;
    const width = span === 365 ? 18 : span === 28 ? 38 : 54;
    const frame = requestAnimationFrame(() => {
      scroller.current?.scrollTo({ x: Math.max(0, index * width - 80), animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [board, span, today, view]);

  if (!phone.ready) return <Centered text="Opening the database…" />;
  if (phone.bootError) return <Centered text={phone.bootError} />;
  if (!phone.hasKey) return <Redirect href="/" />;
  if (error && board === null) return <Centered text={error} action={() => setRetry((value) => value + 1)} />;

  const series = board ? chartSeries(span, board.days, board.tasks, board.focus, board.sleep) : null;
  const taskTitle = span === 365 ? "Tasks completed, by week" : "Tasks completed";
  const focusTitle = span === 365 ? "Focus minutes, by week" : "Focus minutes";
  const sleepTitle = span === 365 ? "Sleep hours, by week" : "Sleep hours";
  const sleepAverage = board ? averageSleep(board.sleep) : null;
  const sleepFigure = sleepAverage === null ? "—" : `${formatHours(sleepAverage)} h`;

  return (
    <ScreenScroll>
      <LaypTitle>Stats</LaypTitle>
      <ChipRow label="Range">
        {RANGES.map((range) => (
          <Chip key={range} label={`${range} days`} selected={span === range} onPress={() => setSpan(range)} />
        ))}
      </ChipRow>
      <ChipRow label="View">
        {VIEWS.map((item) => (
          <Chip key={item} label={VIEW_LABELS[item]} selected={view === item} onPress={() => setView(item)} />
        ))}
      </ChipRow>
      {view === "days" ? (
        <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>Down · Productive · Quiet · Missed</Text>
      ) : null}
      {error ? <Text selectable style={{ color: colors.label }}>{error}</Text> : null}
      {board === null ? <Text style={{ color: colors.label }}>Loading stats…</Text> : null}
      {board?.empty ? <Text style={{ color: colors.label, fontSize: 16 }}>Complete a task or fill a day, and it will count here.</Text> : null}
      {board && series && view === "bars" ? (
        <View style={{ gap: 16 }}>
          <Plot title={taskTitle} values={series.tasks} labels={series.labels} color={TASK_COLOR} kind="bars" />
          <Plot title={focusTitle} values={series.focus} labels={series.labels} color={FOCUS_COLOR} kind="bars" />
        </View>
      ) : null}
      {board && series && view === "line" ? (
        <View style={{ gap: 16 }}>
          <Plot title={taskTitle} values={series.tasks} labels={series.labels} color={TASK_COLOR} kind="line" />
          <Plot title={focusTitle} values={series.focus} labels={series.labels} color={FOCUS_COLOR} kind="line" />
          <Plot title={sleepTitle} values={series.sleep} labels={series.labels} color={SLEEP_COLOR} kind="line" figure={sleepFigure} />
        </View>
      ) : null}
      {board && view === "days" ? (
        <View style={{ flexDirection: "row" }}>
          <View style={{ width: 108 }}>
            <View style={{ height: span === 7 ? 58 : 36 }} />
            {board.rows.map((row) => (
              <View key={row.key} style={{ minHeight: 36, justifyContent: "center", marginTop: row.group ? 10 : 0 }}>
                <Text numberOfLines={1} style={{ color: colors.label, fontSize: 13 }}>{row.name}</Text>
                <Text style={{ color: colors.secondaryLabel, fontSize: 11 }}>{row.total}</Text>
              </View>
            ))}
          </View>
          <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator>
            <View>
              <View style={{ flexDirection: "row", height: span === 7 ? 58 : 36 }}>
                {board.days.map((day, index) => {
                  const head = columnHead(day, index, span);
                  const reading = board.readings[index] ?? "quiet";
                  return (
                    <View key={day} style={{ width: columnWidth(span), alignItems: "center" }} accessibilityLabel={dayPhrase(day, reading)}>
                      <Text style={{ color: colors.secondaryLabel, fontSize: 10 }}>{head.top}</Text>
                      {head.day ? <Text style={{ color: colors.label, fontSize: 12 }}>{head.day}</Text> : null}
                      {span === 7 ? <Text style={{ color: colors.secondaryLabel, fontSize: 9 }}>{READING_LABEL[reading]}</Text> : null}
                      <View style={{ marginTop: 2, height: 4, width: 12, borderRadius: 2, backgroundColor: READING_COLOR[reading] }} />
                    </View>
                  );
                })}
              </View>
              {board.rows.map((row) => (
                <View key={row.key} style={{ flexDirection: "row", marginTop: row.group ? 10 : 0 }}>
                  {row.marks.map((mark, index) => (
                    <MarkCell key={board.days[index] ?? index} mark={mark} span={span} />
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}
    </ScreenScroll>
  );
}

function dayPhrase(day: string, reading: DayReading): string {
  return `${day}, ${READING_LABEL[reading]}`;
}

function columnWidth(span: number): number {
  if (span === 365) return 18;
  if (span === 28) return 38;
  return 54;
}

function MarkCell({ mark, span }: { mark: Mark; span: number }) {
  const filled = mark.color !== null;
  return (
    <View
      accessibilityLabel={mark.title}
      style={{
        width: columnWidth(span),
        minHeight: 36,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          minWidth: span === 365 ? 12 : 28,
          minHeight: span === 365 ? 16 : 24,
          paddingHorizontal: span === 365 ? 0 : 2,
          borderRadius: 4,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: mark.color ?? "transparent",
          borderWidth: mark.tone === "miss" ? 1 : 0,
          borderColor: colors.separator,
        }}
      >
        {mark.dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: mark.dot }} /> : null}
        {span === 365 || !mark.text ? null : (
          <Text style={{ color: filled ? "#111111" : colors.label, fontSize: 10 }}>{mark.text}</Text>
        )}
      </View>
    </View>
  );
}

function Plot({
  title,
  values,
  labels,
  color,
  kind,
  figure,
}: {
  title: string;
  values: Array<number | null>;
  labels: { top: string; day: string }[];
  color: string;
  kind: "bars" | "line";
  figure?: string;
}) {
  const numbers = values.filter((value): value is number => value !== null);
  const total = numbers.reduce((sum, value) => sum + value, 0);
  const slot = values.length > 40 ? 10 : 28;
  const width = Math.max(values.length * slot, 280);
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.label, fontSize: 16, fontWeight: "600" }}>
        {title} {figure ?? total}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{ width }}>
          {kind === "bars" ? <Bars values={numbers} color={color} /> : <Line values={values} color={color} width={width} />}
          <View style={{ flexDirection: "row" }}>
            {(labels.length > 0 ? labels : axisLabels([])).map((label, index) => (
              <View key={`${label.top}-${label.day}-${index}`} style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ color: colors.secondaryLabel, fontSize: 9 }}>{label.top}</Text>
                <Text style={{ color: colors.label, fontSize: 10 }}>{label.day}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Bars({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  return (
    <View style={{ height: 120, flexDirection: "row", alignItems: "flex-end", gap: 2 }}>
      {values.map((value, index) => (
        <View
          key={index}
          style={{
            flex: 1,
            height: value === 0 ? 4 : Math.max(8, Math.round((value / max) * 96)),
            backgroundColor: value === 0 ? colors.separator : color,
            borderRadius: 2,
          }}
        />
      ))}
    </View>
  );
}

function Line({ values, color, width }: { values: Array<number | null>; color: string; width: number }) {
  const numbers = values.filter((value): value is number => value !== null);
  const max = Math.max(1, ...numbers);
  const height = 120;
  const step = values.length === 0 ? 0 : width / values.length;
  const points = values.map((value, index) => {
    if (value === null) return null;
    return {
      x: step * index + step / 2,
      y: height - 8 - (value / max) * (height - 16),
    };
  });
  return (
    <View style={{ height, width }}>
      {points.map((point, index) => {
        const next = points[index + 1];
        if (!point || !next) return null;
        const dx = next.x - point.x;
        const dy = next.y - point.y;
        const length = Math.hypot(dx, dy);
        return (
          <View
            key={index}
            style={{
              position: "absolute",
              left: point.x,
              top: point.y,
              width: length,
              height: 2,
              backgroundColor: color,
              transformOrigin: "left center",
              transform: [{ rotate: `${(Math.atan2(dy, dx) * 180) / Math.PI}deg` }],
            }}
          />
        );
      })}
      {points.map((point, index) =>
        point ? (
          <View
            key={`dot-${index}`}
            style={{
              position: "absolute",
              left: point.x - 3,
              top: point.y - 2,
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: color,
            }}
          />
        ) : null,
      )}
    </View>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        backgroundColor: selected ? primary : colors.grouped,
        borderRadius: 12,
        borderCurve: "continuous",
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: selected ? onPrimary : colors.label, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}
