import { BackgroundTask } from "@/lib/types";

type TaskListener = (tasks: BackgroundTask[]) => void;
type DismissListener = (dismissedIds: string[]) => void;

const STORAGE_KEY = "tgtldr_tracked_tasks";
const DISMISSED_KEY = "tgtldr_dismissed_tasks";

class TaskStore {
  private listeners = new Set<TaskListener>();
  private dismissListeners = new Set<DismissListener>();
  private tasks: BackgroundTask[] = [];
  private dismissedIds = new Set<string>();

  constructor() {
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          this.tasks = JSON.parse(raw);
        }
      } catch {
        this.tasks = [];
      }
      try {
        const rawDismissed = localStorage.getItem(DISMISSED_KEY);
        if (rawDismissed) {
          this.dismissedIds = new Set(JSON.parse(rawDismissed));
        }
      } catch {
        this.dismissedIds = new Set();
      }
    }
  }

  getTasks(): BackgroundTask[] {
    return [...this.tasks];
  }

  getDismissedIds(): string[] {
    return Array.from(this.dismissedIds);
  }

  isDismissed(id: string): boolean {
    return this.dismissedIds.has(id);
  }
  dismissTask(id: string) {
    this.dismissedIds.add(id);
    this.tasks = this.tasks.filter((t) => t.id !== id);
    this.persist();
    this.notify();
    this.notifyDismissed();
  }

  dismissMultiple(ids: string[]) {
    for (const id of ids) {
      this.dismissedIds.add(id);
    }
    const idSet = new Set(ids);
    this.tasks = this.tasks.filter((t) => !idSet.has(t.id));
    this.persist();
    this.notify();
    this.notifyDismissed();
  }

  addTask(task: BackgroundTask) {
    this.dismissedIds.delete(task.id);
    this.tasks = [task, ...this.tasks.filter((t) => t.id !== task.id)].slice(0, 50);
    this.persist();
    this.notify();
    this.notifyDismissed();
  }

  updateTask(id: string, patch: Partial<BackgroundTask>) {
    this.tasks = this.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
    this.persist();
    this.notify();
  }

  removeTask(id: string) {
    this.dismissTask(id);
  }

  clearFinished(finishedIds?: string[]) {
    if (finishedIds && finishedIds.length > 0) {
      this.dismissMultiple(finishedIds);
    } else {
      this.tasks = this.tasks.filter(
        (t) => t.status === "pending" || t.status === "running"
      );
      this.persist();
      this.notify();
    }
  }

  subscribe(listener: TaskListener) {
    this.listeners.add(listener);
    listener(this.getTasks());
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeDismissed(listener: DismissListener) {
    this.dismissListeners.add(listener);
    listener(this.getDismissedIds());
    return () => {
      this.dismissListeners.delete(listener);
    };
  }

  private notify() {
    const current = this.getTasks();
    for (const listener of this.listeners) {
      listener(current);
    }
  }

  private notifyDismissed() {
    const current = this.getDismissedIds();
    for (const listener of this.dismissListeners) {
      listener(current);
    }
  }

  private persist() {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tasks));
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(this.dismissedIds)));
      } catch {
        // ignore quota errors
      }
    }
  }
}

export const taskStore = new TaskStore();
