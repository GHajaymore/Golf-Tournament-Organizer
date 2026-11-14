"use client";
import { useEffect, useState } from "react";
import { thisDevicesPushEndpoint } from "@/lib/push-client";

/**
 * A plain sign-out form's hidden field: this browser's push endpoint, so
 * `signOutAction` forgets the signing-out person's alerts on this device
 * (safety sweep G-4). Filled once the page's script has run; before that the
 * form still signs out, and simply forgets nothing.
 */
export function PushEndpointField() {
  const [endpoint, setEndpoint] = useState("");
  useEffect(() => {
    let live = true;
    void thisDevicesPushEndpoint().then((e) => live && setEndpoint(e));
    return () => {
      live = false;
    };
  }, []);
  return <input type="hidden" name="pushEndpoint" value={endpoint} />;
}
