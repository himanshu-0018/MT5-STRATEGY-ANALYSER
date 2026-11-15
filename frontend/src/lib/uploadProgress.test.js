import { uploadProgress } from "./uploadProgress";

describe("upload progress store", () => {
  afterEach(() => uploadProgress.finish());

  test("starts empty", () => {
    expect(uploadProgress.snapshot()).toBeNull();
  });

  test("tracks files, failures and completion", () => {
    uploadProgress.start(500);
    expect(uploadProgress.snapshot()).toMatchObject({ phase: "parsing", total: 500, done: 0, failed: 0 });
    uploadProgress.update({ done: 137, current: "btc_137.html" });
    expect(uploadProgress.snapshot()).toMatchObject({ done: 137, current: "btc_137.html" });
    uploadProgress.update({ failed: 2 });
    expect(uploadProgress.snapshot().failed).toBe(2);
    uploadProgress.setPhase("building");
    expect(uploadProgress.snapshot().phase).toBe("building");
    uploadProgress.finish();
    expect(uploadProgress.snapshot()).toBeNull();
  });

  test("cancel is sticky until the next start", () => {
    uploadProgress.start(10);
    expect(uploadProgress.isCancelled()).toBe(false);
    uploadProgress.requestCancel();
    expect(uploadProgress.isCancelled()).toBe(true);
    uploadProgress.finish();
    uploadProgress.start(10);
    expect(uploadProgress.isCancelled()).toBe(false);
  });

  test("notifies subscribers on every change and stops after finish", () => {
    let calls = 0;
    const off = uploadProgress.subscribe(() => { calls += 1; });
    uploadProgress.start(2);
    uploadProgress.update({ done: 1 });
    uploadProgress.finish();
    expect(calls).toBe(3);
    off();
    uploadProgress.start(2);
    expect(calls).toBe(3);
  });
});
