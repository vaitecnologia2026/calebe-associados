// =============================================================================
// /api/tracking · Conversions API server-side (Meta CAPI)
// PageView é chamado pelo browser logo após o pixel inicializar.
// O Lead vai pelo backend dentro do POST /api/associates/applications.
// =============================================================================
import { Router } from "express";
import { sendCapiEvent, isCapiEnabled, userFromReqAndForm } from "../services/metaCapi.js";

const r = Router();

r.get("/status", (_req, res) => {
  res.json({
    enabled: isCapiEnabled(),
    testEventCode: process.env.META_TEST_EVENT_CODE || null,
    pixelId: process.env.META_PIXEL_ID ? `${process.env.META_PIXEL_ID.slice(0,4)}…` : null
  });
});

// POST /api/tracking/pageview
// body: { event_id, event_source_url, fbp, fbc }
r.post("/pageview", async (req, res) => {
  if (!isCapiEnabled()) return res.json({ skipped: true });
  const { event_id, event_source_url, fbp, fbc } = req.body || {};
  const user = userFromReqAndForm(req, { fbp, fbc });
  const result = await sendCapiEvent({
    eventName: "PageView",
    eventId: event_id,
    eventSourceUrl: event_source_url,
    user
  });
  res.json(result);
});

export default r;
