"use client";

import { useRef, useState } from "react";
import { Download, FileText, Paperclip, Upload } from "lucide-react";
import { uploadFile } from "@/lib/api";
import { bytes, fmtDate } from "@/lib/format";
import { toast } from "@/lib/store";

export interface FileRow {
  id: number; filename: string; version: number; size_bytes: number; sha256: string; uploaded_at: string;
  uploaded_by?: string | null; slot?: string;
}

export function FileList({ files, empty = "No files yet." }: { files: FileRow[]; empty?: string }) {
  if (!files.length) return <div className="text-[13.5px] text-ink-soft">{empty}</div>;
  return (
    <ul className="divide-y divide-line/70">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-3 py-2 text-[13.5px]">
          <FileText size={16} className="shrink-0 text-ink-soft" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{f.filename} <span className="text-ink-soft">· v{f.version}</span></div>
            <div className="truncate text-[12px] text-ink-soft" title={`SHA-256 ${f.sha256}`}>
              {bytes(f.size_bytes)} · {fmtDate(f.uploaded_at)}{f.uploaded_by ? ` · ${f.uploaded_by}` : ""} · SHA-256 {f.sha256.slice(0, 12)}…
            </div>
          </div>
          <a href={`/api/files/${f.id}`} className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-[12.5px] no-underline hover:border-brand" download>
            <Download size={13} /> Download
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Pick a file and upload it straight away; calls onUploaded with the stored file id. */
export function FilePicker({ entityType, entityId, slot, onUploaded, label = "Attach a file" }: {
  entityType: string; entityId: number; slot: string; onUploaded: (f: { id: number; name: string; sha256: string }) => void; label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const pick = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Files must be 2 MB or smaller.");
      return;
    }
    setBusy(true);
    try {
      const r = await uploadFile(entityType, entityId, slot, file);
      setDone(`${file.name} (v${r.version})`);
      onUploaded({ id: r.id, name: file.name, sha256: r.sha256 });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={input} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain"
        onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" onClick={() => input.current?.click()} disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-line bg-paper/60 px-3 py-1.5 text-[13.5px] hover:border-brand hover:text-brand disabled:opacity-60">
        {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" /> : <Upload size={14} />}
        {busy ? "Uploading…" : label}
      </button>
      {done && <span className="inline-flex items-center gap-1 text-[13px] text-olive-ink"><Paperclip size={13} />{done}</span>}
      <span className="text-[12px] text-ink-soft">PDF, PNG, JPEG or text, up to 2 MB</span>
    </div>
  );
}
