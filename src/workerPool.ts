interface Task {
	id: string;
	priority: number;
	type: "filter" | "textCache" | "nodeSize" | "forceParams";
	data: any;
	resolve: (value: any) => void;
	reject: (reason: any) => void;
}

interface Worker_ {
	worker: Worker;
	busy: boolean;
}

export class WorkerPool {
	private workers: Worker_[] = [];
	private taskQueue: Task[] = [];
	private taskMap = new Map<string, Task>();

	constructor(poolSize: number = 4) {
		const size = Math.max(2, Math.min(poolSize, navigator.hardwareConcurrency || 4));
		for (let i = 0; i < size; i++) {
			const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
			worker.onmessage = (event: MessageEvent) => this.handleMessage(event, i);
			worker.onerror = () => {
				this.workers[i].busy = false;
				this.processNextTask();
			};
			this.workers.push({ worker, busy: false });
		}
	}

	private handleMessage(event: MessageEvent, idx: number) {
		const { taskId, result } = event.data;
		const task = this.taskMap.get(taskId);
		if (task) {
			task.resolve(result);
			this.taskMap.delete(taskId);
		}
		this.workers[idx].busy = false;
		this.processNextTask();
	}

	private processNextTask() {
		this.taskQueue.sort((a, b) => a.priority - b.priority);
		if (!this.taskQueue.length) return;

		const w = this.workers.find(w => !w.busy);
		if (!w) return;

		const task = this.taskQueue.shift();
		if (!task) return;

		w.busy = true;
		w.worker.postMessage({
			taskId: task.id,
			type: task.type,
			...task.data,
		});
	}

	addTask<T>(type: "filter" | "textCache" | "nodeSize" | "forceParams", data: any, priority: number = 50): Promise<T> {
		return new Promise((resolve, reject) => {
			const taskId = `${type}-${Date.now()}-${Math.random()}`;
			const task = { id: taskId, type, priority, data, resolve, reject };
			this.taskMap.set(taskId, task);
			this.taskQueue.push(task);
			this.processNextTask();
		});
	}

	terminate() {
		this.taskQueue = [];
		this.taskMap.clear();
		this.workers.forEach(w => w.worker.terminate());
		this.workers = [];
	}
}

export class BatchProcessor {
	private results: Map<string, any> = new Map();
	private pending: Set<string> = new Set();
	private callback: ((result: any) => void) | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private delay: number;

	constructor(delay: number = 50) {
		this.delay = delay;
	}

	registerTask(taskId: string) {
		this.pending.add(taskId);
	}

	addResult(taskId: string, result: any) {
		this.results.set(taskId, result);
		this.pending.delete(taskId);
		if (!this.pending.size) this.scheduleUpdate();
	}

	failTask(taskId: string) {
		this.pending.delete(taskId);
		if (!this.pending.size) this.scheduleUpdate();
	}

	onUpdate(callback: (result: any) => void) {
		this.callback = callback;
	}

	private scheduleUpdate() {
		if (this.timer) return;
		this.timer = setTimeout(() => this.executeUpdate(), this.delay);
	}

	private executeUpdate() {
		this.timer = null;
		if (!this.results.size || !this.callback) return;

		const batch: any = {};
		this.results.forEach((result, taskId) => {
			if (taskId.startsWith("filter-")) {
				const { filteredNodeIds, filteredLinkIds, searchedNodeId } = result;
				batch.filteredNodeIds = new Set(filteredNodeIds);
				batch.filteredLinkIds = filteredLinkIds;
				batch.searchedNodeId = searchedNodeId;
			} else if (taskId.startsWith("textCache-")) {
				batch.textLineCache = result.textLineCache;
			} else if (taskId.startsWith("nodeSize-")) {
				batch.nodeSizeCache = result.nodeSizeCache;
			} else if (taskId.startsWith("forceParams-")) {
				batch.forceParams = result;
			}
		});

		this.results.clear();
		this.callback(batch);
	}

	clear() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.results.clear();
		this.pending.clear();
	}
}
