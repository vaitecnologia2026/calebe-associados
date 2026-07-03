import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "@/router";
import { useAuth } from "@/store/auth";
import { initTracking } from "@/lib/tracking";
import { initPwa } from "@/lib/pwa";
import { ToastHost } from "@/components/ui/Toast";

export function App() {
  const restoreSession = useAuth((s) => s.restoreSession);

  useEffect(() => {
    initTracking();
    initPwa();
    void restoreSession();
  }, [restoreSession]);

  return (
    <>
      <RouterProvider router={router} />
      <ToastHost />
    </>
  );
}
