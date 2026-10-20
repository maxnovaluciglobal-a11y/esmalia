import { useState } from "react";

import { PattyCara } from "./patty-cara";

/** Patty como personaje: un chip flotante que lleva a su sección. Se cierra. */
export function PattyChip() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div className="lv-patty-chip">
      <PattyCara className="lv-pav" />
      <a className="txt" href="#patty">
        <b>Hola, soy Patty.</b> <span>Estoy en habilitación. Baja y te cuento qué haré.</span>
      </a>
      <button
        className="x"
        type="button"
        aria-label="Ocultar a Patty"
        onClick={() => setVisible(false)}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </button>
    </div>
  );
}
