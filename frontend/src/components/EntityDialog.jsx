import { useState, useEffect } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Button, Stack, Alert,
} from "@mui/material";
import { useMediaQuery } from "react-responsive";

// Input types the browser renders with its own picker, so the label must not
// sit on top of the placeholder value.
const SHRINK_TYPES = ["month", "date", "datetime-local", "time"];
const PASSTHROUGH_TYPES = [
  "email", "month", "date", "datetime-local", "time", "number", "password",
];

export default function EntityDialog({
  open, title, fields, initial, onClose, onSave,
}) {
  const [form, setForm] = useState(initial || {});
  const [errors, setErrors] = useState({});
  const [apiErr, setApiErr] = useState("");
  const [saving, setSaving] = useState(false);
  const isMobile = useMediaQuery({ maxWidth: 768 });

  useEffect(() => {
    setForm(initial || {});
    setErrors({});
    setApiErr("");
  }, [initial, open]);

  const validate = () => {
    const next = {};
    fields.forEach((f) => {
      const val = form[f.name];

      if (f.required && !String(val ?? "").trim()) {
        next[f.name] = `${f.label} is required`;
      }

      if (f.type === "email" && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val))) {
        next[f.name] = "Must be a valid email address";
      }

      if (f.type === "month" && val && !/^\d{4}-\d{2}$/.test(String(val))) {
        next[f.name] = "Must be a valid month";
      }

      if (f.type === "number" && val !== "" && val != null) {
        if (Number.isNaN(Number(val))) {
          next[f.name] = "Must be a number";
        } else if (f.min != null && Number(val) < f.min) {
          next[f.name] = `Must be ${f.min} or more`;
        } else if (f.max != null && Number(val) > f.max) {
          next[f.name] = `Must be ${f.max} or less`;
        }
      }

      if (f.maxLength && String(val ?? "").length > f.maxLength) {
        next[f.name] = `Must be ${f.maxLength} characters or fewer`;
      }
    });
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSaving(true);
    setApiErr("");
    try {
      await onSave(form);
      onClose();
    } catch (e) {
      setApiErr(typeof e === "string" ? e : e?.message || "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  // Submit on Enter, except inside a multiline field where Enter adds a newline.
  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && e.target.tagName !== "TEXTAREA") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={isMobile}
    >
      <DialogTitle sx={{ pb: 1 }}>{title}</DialogTitle>

      <DialogContent>
        {apiErr && <Alert severity="error" sx={{ mb: 2 }}>{apiErr}</Alert>}

        <Stack spacing={2.5} mt={1} onKeyDown={onKeyDown}>
          {fields.map((f) => {
            const isSelect = !!f.options;
            const type = PASSTHROUGH_TYPES.includes(f.type) ? f.type : "text";

            return (
              <TextField
                key={f.name}
                label={f.label}
                required={f.required}
                select={isSelect}
                type={isSelect ? undefined : type}
                multiline={!!f.multiline}
                minRows={f.multiline ? 2 : undefined}
                maxRows={f.multiline ? 6 : undefined}
                value={form[f.name] ?? ""}
                onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                error={!!errors[f.name]}
                helperText={errors[f.name] || f.help || ""}
                disabled={saving}
                fullWidth
                InputLabelProps={
                  SHRINK_TYPES.includes(f.type) ? { shrink: true } : undefined
                }
                inputProps={
                  f.type === "number" ? { min: f.min, max: f.max } : undefined
                }
              >
                {f.options?.map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </TextField>
            );
          })}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}