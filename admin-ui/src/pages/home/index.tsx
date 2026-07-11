import {
  Activity,
  ArrowRight,
  Check,
  Copy,
  Database,
  FileClock,
  HardDrive,
  KeyRound,
  ScrollText,
  ShieldAlert,
  Table2,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api, type LogEntry, type Stats, type TableInfo } from "../../api";
import { Badge, CodeBlock, Spinner, Time, useCopy } from "../../components/ui";
import { navigate } from "../../lib/router";
import { apiUrl, inProcessSnippet } from "../../lib/snippet";
import { Finding, fetchFindings, openAdvisor } from "../../components/advisor";

interface Migration {
  version: string;
  name: string | null;
  applied_at: string;
}

/** Project overview: health, key stats, advisor findings, recent activity. */
export function HomePage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [issues, setIssues] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);

  const url = apiUrl();
  const urlCopy = useCopy(url, "API URL");

  useEffect(() => {
    Promise.allSettled([
      api.stats(),
      api.tables(),
      api.migrations(),
      api.logs(),
      fetchFindings(),
    ]).then(([s, t, m, l, f]) => {
      if (s.status === "fulfilled") setStats(s.value);
      setTables(t.status === "fulfilled" ? t.value : []);
      if (m.status === "fulfilled") setMigrations(m.value);
      if (l.status === "fulfilled") setLogs(l.value);
      if (f.status === "fulfilled") setIssues(f.value);
      setLoading(false);
    });
  }, []);

  if (loading) return <Spinner />;

  const totalRows = tables.reduce((s, t) => s + t.rowCount, 0);
  const lastMigration = migrations[migrations.length - 1];
  const recentLogs = logs.slice(-8).reverse();
  const errorCount = logs.filter((l) => l.level === "error").length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl space-y-12 px-10 py-12">
        {/* ── hero ── */}
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-foreground">tinbase</h1>
            <Badge variant="brand">
              <span className="inline-block size-1.5 rounded-full bg-brand" />{" "}
              Healthy
            </Badge>
          </div>
          <button
            onClick={urlCopy.copy}
            title={urlCopy.copied ? "Copied!" : "Copy API URL"}
            className="group mt-1.5 flex items-center gap-2 font-mono text-[13px] text-muted-foreground/80 transition-colors hover:text-foreground"
          >
            {url}
            {urlCopy.copied ? (
              <Check size={11} className="text-brand" />
            ) : (
              <Copy
                size={11}
                className="opacity-0 transition-opacity group-hover:opacity-100"
              />
            )}
          </button>

          <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            <Fact icon={Activity} label="Status" value="Healthy" accent />
            <Fact
              icon={Database}
              label="Database size"
              value={stats?.dbSize ?? "—"}
            />
            <Fact icon={Zap} label="Version" value={stats?.version ?? "—"} />
            <Fact
              icon={FileClock}
              label="Last migration"
              value={
                lastMigration
                  ? (lastMigration.name ?? lastMigration.version)
                  : "No migrations"
              }
              sub={
                lastMigration ? (
                  <Time value={lastMigration.applied_at} />
                ) : undefined
              }
            />
            <Fact
              icon={Table2}
              label="Tables"
              value={`${stats?.tables ?? 0}`}
              sub={`${totalRows.toLocaleString()} total rows`}
            />
            <Fact
              icon={KeyRound}
              label="Auth users"
              value={`${stats?.users ?? 0}`}
            />
          </div>
        </div>

        {/* ── at a glance ── */}
        <Section title="At a glance">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              icon={Table2}
              label="Table Editor"
              value={stats?.tables ?? 0}
              sub={`${totalRows.toLocaleString()} rows`}
              onClick={() => navigate("table")}
            />
            <StatCard
              icon={KeyRound}
              label="Authentication"
              value={stats?.users ?? 0}
              sub="users"
              onClick={() => navigate("auth")}
            />
            <StatCard
              icon={HardDrive}
              label="Storage"
              value={stats?.buckets ?? 0}
              sub={`${stats?.objects ?? 0} objects`}
              onClick={() => navigate("storage")}
            />
            <StatCard
              icon={ScrollText}
              label="Logs"
              value={logs.length}
              sub={errorCount > 0 ? `${errorCount} errors` : "no errors"}
              danger={errorCount > 0}
              onClick={() => navigate("logs")}
            />
          </div>
        </Section>

        {/* ── advisor (shared engine; header lightbulb opens the full sheet) ── */}
        <Section
          title="Advisor"
          action={
            issues.length > 0 ? (
              <button
                className="text-xs text-brand hover:underline"
                onClick={openAdvisor}
              >
                View all {issues.length}
              </button>
            ) : undefined
          }
        >
          {issues.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-5 text-[13px] text-muted-foreground">
              <Check size={15} className="text-brand" /> No advisor findings —
              security and performance checks all pass.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              {issues.slice(0, 6).map((f) => (
                <button
                  key={f.id}
                  onClick={openAdvisor}
                  className="flex w-full items-center gap-3 border-b border-border/60 px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-accent/40"
                >
                  <ShieldAlert
                    size={14}
                    className={
                      f.level === "critical"
                        ? "text-destructive"
                        : f.level === "warning"
                          ? "text-warning"
                          : "text-muted-foreground/70"
                    }
                  />
                  <span className="shrink-0 text-[13px] text-foreground/90">
                    {f.title}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {f.entity}
                  </span>
                  <ArrowRight
                    size={12}
                    className="ml-auto shrink-0 text-muted-foreground/60"
                  />
                </button>
              ))}
            </div>
          )}
        </Section>

        {/* ── activity ── */}
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel
            title="Recent migrations"
            onMore={() => navigate("database", "migrations")}
          >
            {migrations.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground/60">
                No migrations applied. Add SQL files under{" "}
                <code className="text-muted-foreground">
                  supabase/migrations/
                </code>
                .
              </p>
            ) : (
              migrations
                .slice(-6)
                .reverse()
                .map((m) => (
                  <div
                    key={m.version}
                    className="flex items-center gap-3 border-b border-border/60 px-4 py-2 last:border-0"
                  >
                    <span className="font-mono text-xs text-muted-foreground/80">
                      {m.version}
                    </span>
                    <span className="truncate text-[13px] text-foreground/80">
                      {m.name ?? "—"}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/60">
                      <Time value={m.applied_at} />
                    </span>
                  </div>
                ))
            )}
          </Panel>

          <Panel title="Recent logs" onMore={() => navigate("logs")}>
            {recentLogs.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground/60">
                No log entries yet.
              </p>
            ) : (
              recentLogs.map((l, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 border-b border-border/60 px-4 py-2 last:border-0"
                >
                  <span
                    className={
                      "size-1.5 shrink-0 rounded-full " +
                      (l.level === "error"
                        ? "bg-destructive"
                        : l.level === "warn"
                          ? "bg-warning"
                          : "bg-muted-foreground/60")
                    }
                  />
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {l.msg}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/60">
                    <Time value={l.ts} format="time" />
                  </span>
                </div>
              ))
            )}
          </Panel>
        </div>

        {/* ── get connected ── */}
        <Section title="Get connected">
          <div className="rounded-lg border border-border bg-card p-6">
            <p className="text-[13px] text-muted-foreground/80">
              Every tinbase service is a{" "}
              <span className="text-foreground/80">(Request) ⇒ Response</span>{" "}
              fetch handler — run the whole backend in-process, or point{" "}
              <span className="text-foreground/80">supabase-js</span> at this
              server (URL + keys under{" "}
              <span className="text-foreground/80">Connect</span>).
            </p>
            <div className="mt-3">
              <CodeBlock code={inProcessSnippet()} lang="js" />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

/* ── pieces ── */

function Fact({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof Table2;
  label: string;
  value: string;
  sub?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex items-start gap-3.5">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-card">
        <Icon
          size={17}
          className={accent ? "text-brand" : "text-muted-foreground/80"}
        />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {label}
        </p>
        <p
          className={
            "mt-0.5 truncate text-sm " +
            (accent ? "text-brand" : "text-foreground")
          }
        >
          {value}
        </p>
        {sub && (
          <p className="truncate text-xs text-muted-foreground/60">{sub}</p>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-base font-medium text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Panel({
  title,
  onMore,
  children,
}: {
  title: string;
  onMore?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
        {onMore && (
          <button
            onClick={onMore}
            className="flex items-center gap-1 text-[11px] text-muted-foreground/80 transition-colors hover:text-brand"
          >
            View all <ArrowRight size={11} />
          </button>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  danger,
  onClick,
}: {
  icon: typeof Table2;
  label: string;
  value: number;
  sub: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-muted-foreground"
    >
      <div className="flex items-center gap-2 text-muted-foreground/80">
        <Icon size={13} />
        <span className="text-[11px] font-medium uppercase tracking-wide">
          {label}
        </span>
        <ArrowRight
          size={12}
          className="ml-auto opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>
      <p className="mt-3 text-3xl font-semibold text-foreground">
        {value.toLocaleString()}
      </p>
      <p
        className={
          "mt-1 text-[13px] " +
          (danger ? "text-destructive" : "text-muted-foreground/80")
        }
      >
        {sub}
      </p>
    </button>
  );
}
