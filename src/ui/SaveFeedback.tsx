import { Check } from "lucide-react";

export function SaveFeedback({ message, sequence }: { message: string; sequence: number }) {
  return (
    <div className="pixel-save-feedback" key={sequence} role="status">
      <span className="pixel-save-check" aria-hidden="true">
        <Check size={24} strokeWidth={3} />
      </span>
      <div>
        <strong>记录已更新</strong>
        <span>{message}</span>
      </div>
      <span className="pixel-save-particles" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
