import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfirmDialog from "./ConfirmDialog";

/**
 * This stands between the user and every irreversible action, so the things
 * worth proving are that it can't fire twice, can't be dismissed mid-delete,
 * and always says what is about to happen.
 */

function setup(props = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();

  render(
    <ConfirmDialog
      open
      title="Delete team"
      message='Delete "Platform engineering"?'
      onConfirm={onConfirm}
      onClose={onClose}
      {...props}
    />
  );

  return { onConfirm, onClose, user: userEvent.setup() };
}

describe("rendering", () => {
  it("names what is about to be deleted", () => {
    setup();
    expect(screen.getByText("Delete team")).toBeInTheDocument();
    expect(
      screen.getByText('Delete "Platform engineering"?')
    ).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    setup({ open: false });
    expect(screen.queryByText("Delete team")).not.toBeInTheDocument();
  });

  it("spells out the knock-on effects when there are any", () => {
    setup({
      consequence: "Its projects and achievements will be removed too.",
    });
    expect(
      screen.getByText(/projects and achievements will be removed/i)
    ).toBeInTheDocument();
  });

  it("uses a custom action label where the word delete would be wrong", () => {
    setup({ confirmLabel: "Remove" });
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete" })
    ).not.toBeInTheDocument();
  });

  it("defaults to Delete when no label is given", () => {
    setup();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});

describe("acting", () => {
  it("calls onConfirm when confirmed", async () => {
    const { onConfirm, user } = setup();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onClose and nothing else when cancelled", async () => {
    const { onConfirm, onClose, user } = setup();

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("while deleting", () => {
  it("disables both buttons so the action can't fire twice", () => {
    setup({ busy: true });

    expect(screen.getByRole("button", { name: /deleting/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
  });

  it("says what it is doing", () => {
    setup({ busy: true });
    expect(screen.getByRole("button", { name: /deleting/i })).toBeInTheDocument();
  });

  it("cannot be clicked again while in flight", () => {
    // Deleting isn't idempotent — a second request would 404 and show the
    // user an error for something that actually worked. The button being
    // disabled is what prevents it; user-event refuses to click a disabled
    // element, so asserting the state is the meaningful check.
    const { onConfirm } = setup({ busy: true });

    const confirm = screen.getByRole("button", { name: /deleting/i });
    expect(confirm).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});