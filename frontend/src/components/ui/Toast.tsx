import { useUi } from "@/store/ui";

export function ToastHost() {
  const toast = useUi((s) => s.toast);
  const clear = useUi((s) => s.clearToast);

  if (!toast) return null;
  return (
    <div className={`toast ${toast.visible ? "visible" : ""}`}>
      <span>{toast.msg}</span>
      {toast.undo && (
        <button
          className="ml-3 underline font-semibold"
          onClick={() => { toast.undo?.(); clear(); }}
        >
          Desfazer
        </button>
      )}
    </div>
  );
}
