import {
  Button,
  ConfirmDialog,
  Empty,
  Input,
  Label,
  Sheet,
  SheetClose,
  Spinner,
  THead,
  TRow,
  Table,
  Td,
  Textarea,
  Th,
  Time,
  ValueCell,
  toast,
} from "../../components/ui";
import { CatalogHeader, quoteLit } from "../database/shared";
import { Eye, Plus, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "../../api";

interface Queue {
  name: string;
  depth: number;
  archived: number;
}

const VALID_QUEUE = /^[a-z_][a-z0-9_]{0,46}$/;

/** pgmq queues: list with depth, create, send test messages, peek, purge. */
export function QueuesSection() {
  const [queues, setQueues] = useState<Queue[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [sendingTo, setSendingTo] = useState<Queue | null>(null);
  const [peeking, setPeeking] = useState<Queue | null>(null);
  const [purging, setPurging] = useState<Queue | null>(null);

  const load = useCallback(async () => {
    const res = await api.sql(
      `select replace(t.table_name, 'q_', '') as name,
              (xpath('/row/cnt/text()', query_to_xml('select count(*) as cnt from pgmq.' || quote_ident(t.table_name), false, true, '')))[1]::text::int as depth
       from information_schema.tables t
       where t.table_schema = 'pgmq' and t.table_name like 'q\\_%' order by 1`,
    );
    if (res.ok) {
      setQueues(
        ((res.rows ?? []) as { name: string; depth: number }[]).map((r) => ({
          ...r,
          archived: 0,
        })),
      );
      return;
    }
    // xpath/query_to_xml may be unavailable — fall back to names only, then count one by one
    const names = await api.sql(
      `select replace(table_name, 'q_', '') as name from information_schema.tables
       where table_schema = 'pgmq' and table_name like 'q\\_%' order by 1`,
    );
    if (!names.ok) {
      setQueues([]);
      return;
    }
    const out: Queue[] = [];
    for (const r of (names.rows ?? []) as { name: string }[]) {
      if (!VALID_QUEUE.test(r.name)) continue;
      const c = await api.sql(
        `select count(*)::int as depth from pgmq.${"q_" + r.name}`,
      );
      out.push({
        name: r.name,
        depth: c.ok ? ((c.rows?.[0]?.depth as number) ?? 0) : 0,
        archived: 0,
      });
    }
    setQueues(out);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function purge(q: Queue) {
    const res = await api.sql(`delete from pgmq.${"q_" + q.name}`);
    if (!res.ok) {
      toast.error(res.error ?? "Purge failed");
      return;
    }
    toast.success(`Purged queue ${q.name}`);
    await load();
  }

  if (queues === null) return <Spinner />;

  return (
    <div className="flex h-full flex-col">
      <CatalogHeader
        title="Queues"
        description="pgmq-compatible message queues — send/read/pop from SQL or supabase.schema('pgmq').rpc(…)."
        onRefresh={() => void load()}
        actions={
          <Button size="xs" onClick={() => setCreating(true)}>
            <Plus size={12} /> New queue
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <THead>
            <tr>
              <Th>Queue</Th>
              <Th>Depth</Th>
              <Th className="w-28" />
            </tr>
          </THead>
          <tbody>
            {queues.map((q) => (
              <TRow key={q.name}>
                <Td className="font-mono text-foreground/90">{q.name}</Td>
                <Td className="tabular-nums text-muted-foreground">
                  {q.depth}
                </Td>
                <Td>
                  <div className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100">
                    <button
                      className="p-1 text-muted-foreground/80 hover:text-foreground"
                      title="Peek messages"
                      onClick={() => setPeeking(q)}
                    >
                      <Eye size={13} />
                    </button>
                    <button
                      className="p-1 text-muted-foreground/80 hover:text-foreground"
                      title="Send test message"
                      onClick={() => setSendingTo(q)}
                    >
                      <Send size={13} />
                    </button>
                    <button
                      className="p-1 text-muted-foreground/80 hover:text-destructive"
                      title="Purge queue"
                      onClick={() => setPurging(q)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {queues.length === 0 && (
          <Empty>
            No queues yet. Create one here or via{" "}
            <code className="text-muted-foreground">
              select pgmq.create('jobs')
            </code>
            .
          </Empty>
        )}
      </div>

      {creating && (
        <CreateQueueDialog
          onClose={() => setCreating(false)}
          onDone={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}
      {sendingTo && (
        <SendDialog
          queue={sendingTo}
          onClose={() => setSendingTo(null)}
          onDone={async () => {
            setSendingTo(null);
            await load();
          }}
        />
      )}
      {peeking && (
        <PeekSheet queue={peeking} onClose={() => setPeeking(null)} />
      )}
      {purging && (
        <ConfirmDialog
          open
          danger
          title={`Purge queue "${purging.name}"?`}
          description={`All ${purging.depth} pending messages are permanently deleted.`}
          confirmLabel="Purge"
          onConfirm={() => void purge(purging)}
          onClose={() => setPurging(null)}
        />
      )}
    </div>
  );
}

function CreateQueueDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!VALID_QUEUE.test(name))
      return setErr("Lowercase letters, digits and underscores only.");
    setBusy(true);
    setErr("");
    const res = await api.sql(`select pgmq.create(${quoteLit(name)})`);
    if (!res.ok) {
      setErr(res.error ?? "Create failed");
      setBusy(false);
      return;
    }
    toast.success(`Created queue ${name}`);
    await onDone();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="w-120"
      title="Create a new queue"
      footer={
        <>
          {err && <p className="min-w-0 truncate text-xs text-destructive">{err}</p>}
          <div className="ml-auto flex items-center gap-2">
            <SheetClose asChild>
              <Button variant="outline">Cancel</Button>
            </SheetClose>
            <Button onClick={() => void create()} disabled={busy || !name}>
              {busy ? "Creating…" : "Create queue"}
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label>Name</Label>
          <Input
            mono
            value={name}
            autoFocus
            placeholder="jobs"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
          />
          <p className="mt-1 text-[11px] text-muted-foreground/60">Lowercase letters, digits and underscores.</p>
        </div>
      </div>
    </Sheet>
  );
}

function SendDialog({
  queue,
  onClose,
  onDone,
}: {
  queue: Queue;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [payload, setPayload] = useState('{ "task": "hello" }');
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    try {
      JSON.parse(payload);
    } catch {
      return setErr("Payload must be valid JSON.");
    }
    setBusy(true);
    setErr("");
    const res = await api.sql(
      `select pgmq.send(${quoteLit(queue.name)}, ${quoteLit(payload)}::jsonb)`,
    );
    if (!res.ok) {
      setErr(res.error ?? "Send failed");
      setBusy(false);
      return;
    }
    toast.success(`Sent to ${queue.name}`);
    await onDone();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="w-120"
      title={
        <span>
          Send message to{" "}
          <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs text-foreground">{queue.name}</code>
        </span>
      }
      footer={
        <>
          {err && <p className="min-w-0 truncate text-xs text-destructive">{err}</p>}
          <div className="ml-auto flex items-center gap-2">
            <SheetClose asChild>
              <Button variant="outline">Cancel</Button>
            </SheetClose>
            <Button onClick={() => void send()} disabled={busy}>
              {busy ? "Sending…" : "Send message"}
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label>Message (JSON)</Label>
          <Textarea
            rows={6}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
          />
        </div>
      </div>
    </Sheet>
  );
}

function PeekSheet({ queue, onClose }: { queue: Queue; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);

  useEffect(() => {
    api
      .sql(
        `select msg_id, read_ct, enqueued_at, vt, message from pgmq.${"q_" + queue.name} order by msg_id desc limit 50`,
      )
      .then((res) =>
        setRows(res.ok ? ((res.rows ?? []) as Record<string, unknown>[]) : []),
      );
  }, [queue.name]);

  return (
    <Sheet
      open
      onClose={onClose}
      flush
      width="w-[620px]"
      title={
        <span>
          Messages in{" "}
          <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs text-foreground">
            {queue.name}
          </code>
        </span>
      }
      footer={
        <SheetClose asChild>
          <Button variant="outline" className="ml-auto">
            Done
          </Button>
        </SheetClose>
      }
    >
      {rows === null ? (
        <div className="p-5">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <Empty>Queue is empty.</Empty>
      ) : (
        <div className="h-full overflow-auto">
          <Table>
            <THead>
              <tr>
                <Th>id</Th>
                <Th>reads</Th>
                <Th>enqueued</Th>
                <Th>message</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((r, i) => (
                <TRow key={i}>
                  <Td className="font-mono text-muted-foreground">
                    {String(r.msg_id)}
                  </Td>
                  <Td className="tabular-nums text-muted-foreground">
                    {String(r.read_ct)}
                  </Td>
                  <Td className="text-muted-foreground">
                    <Time value={r.enqueued_at as string} />
                  </Td>
                  <Td className="max-w-70 truncate font-mono text-[11px]">
                    <ValueCell value={r.message} />
                  </Td>
                </TRow>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Sheet>
  );
}
