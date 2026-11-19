"use client";

import { useState } from "react";

// Only the reveal toggle needs client state. The input is still a plain
// uncontrolled field inside the Server Action form, so the password is posted
// by the form itself and never held in React state.
export function PasswordField() {
  const [visible, setVisible] = useState(false);

  return (
    <div className="inp-ic">
      <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 018 0v3" />
      </svg>
      <input
        id="password"
        name="password"
        type={visible ? "text" : "password"}
        autoComplete="current-password"
        required
        maxLength={256}
      />
      <button
        type="button"
        className="eye"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}
