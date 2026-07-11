import { Check, Copy, LogOut, Plug, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api, getKey } from "../../api";
import { apiUrl, inProcessSnippet } from "../../lib/snippet";
import { AdvisorButton } from "../advisor";
import { Badge, Button, CodeBlock, CopyButton, Dialog, Input, Kbd, KeyField, Label, useCopy } from "../ui";

import { Logo } from "./logo";

/**
 * Top application header showing the tinbase branding, a click-to-copy API URL,
 * a Connect action that opens the connection-details dialog, and a log-out button.
 *
 * @param props.onLogout - Invoked when the user clicks the log-out button.
 */
export function Header({ onLogout }: { onLogout: () => void }) {
  const [connect, setConnect] = useState(false);
  const url = apiUrl();
  const urlCopy = useCopy(url, "API URL");

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
      <div className="flex items-center gap-2 pl-1">
        <Logo size={22} />
        <span className="text-[13px] font-semibold text-foreground">
          tinbase
        </span>
        <Badge variant="outline">studio</Badge>
      </div>
      <span className="text-muted-foreground">/</span>
      <button
        onClick={urlCopy.copy}
        title={urlCopy.copied ? "Copied!" : "Copy API URL"}
        className="group flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {url.replace(/^https?:\/\//, "")}
        {urlCopy.copied ? (
          <Check size={11} className="text-brand" />
        ) : (
          <Copy
            size={11}
            className="opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
          className="flex h-7 items-center gap-2 rounded-md border border-input bg-field px-2.5 text-xs text-muted-foreground/80 transition-colors hover:border-muted-foreground hover:text-foreground"
          title="Search (Ctrl+K)"
        >
          <Search size={12} />
          Search…
          <Kbd>⌘K</Kbd>
        </button>
        <Button size="xs" className="h-7" onClick={() => setConnect(true)}>
          <Plug size={12} /> Connect
        </Button>
        <AdvisorButton />
        <Button variant="outline" size="icon" className="size-7" title="Log out" onClick={onLogout}>
          <LogOut size={13} />
        </Button>
      </div>

      <ConnectDialog open={connect} onClose={() => setConnect(false)} />
    </header>
  );
}

function ConnectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const url = apiUrl();
  const serviceKey = getKey();
  const [anonKey, setAnonKey] = useState("");

  useEffect(() => {
    if (!open) return;
    api.keys().then(
      (k) => setAnonKey(k.anonKey ?? ""),
      () => setAnonKey(""),
    );
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title="Connect to tinbase" wide>
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground/80">
          tinbase is a{" "}
          <span className="text-foreground/80">Supabase-compatible</span> backend
          in one process — REST, Auth, Storage, and Realtime speak the same wire
          protocols, so the official{" "}
          <span className="text-foreground/80">supabase-js</span> SDK connects
          unchanged.
        </p>
        <div>
          <Label>API URL</Label>
          <div className="flex items-center gap-2">
            <Input mono readOnly value={url} />
            <CopyButton value={url} label="API URL" variant="outline" size="icon" iconSize={13} />
          </div>
        </div>
        <KeyField
          label="anon key"
          hint="safe for browsers — RLS applies"
          value={anonKey}
        />
        <KeyField
          label="service_role key"
          hint="server-side only — bypasses RLS"
          value={serviceKey}
          danger
        />
        <div>
          <Label>Get Started</Label>
          <CodeBlock code={inProcessSnippet()} lang="js" />
        </div>
      </div>
    </Dialog>
  );
}
