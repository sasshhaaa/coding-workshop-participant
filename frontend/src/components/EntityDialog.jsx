import { useState, useEffect } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Button, Stack, Alert,
} from "@mui/material";
import { useMediaQuery } from "react-responsive";

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
      if (f.type === "email" && val && !String(val).includes("@")) {
        next[f.name] = "Must be a valid email";
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
      setApiErr(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={isMobile}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {apiErr && <Alert severity="error" sx={{ mb: 2 }}>{apiErr}</Alert>}
        <Stack spacing={2} mt={1}>
          {fields.map((f) => (
            <TextField
              key={f.name}
              label={f.label}
              required={f.required}
              select={!!f.options}
              type={f.type === "email" ? "email" : "text"}
              value={form[f.name] ?? ""}
              onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
              error={!!errors[f.name]}
              helperText={errors[f.name] || f.help || ""}
              disabled={saving}
              fullWidth
            >
              {f.options?.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </TextField>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}