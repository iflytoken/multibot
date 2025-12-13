// src/engine/metrics.ts

export class Metrics {
    private scanCount: number = 0;
    private lastScanMs: number = 0;
    private oppsFound: number = 0;
    private directArbs: number = 0;
    private triArbs: number = 0;
    private execAttempts: number = 0;
    private execSuccess: number = 0;
    private execFail: number = 0;

    private lastScanStart: number = 0;

    constructor() {}

    startScan() {
        this.lastScanStart = Date.now();
    }

    recordScan(poolCount: number, oppCount: number) {
        this.scanCount++;
        this.oppsFound += oppCount;
        this.lastScanMs = Date.now() - this.lastScanStart;

        // split opp types if needed
        this.triArbs += oppCount;
    }

    recordExecutionSuccess() {
        this.execAttempts++;
        this.execSuccess++;
    }

    recordExecutionFail() {
        this.execAttempts++;
        this.execFail++;
    }

    getLastScanTime(): number {
        return this.lastScanMs;
    }

    summaryString(): string {
        return (
            `📊 METRICS SUMMARY | ` +
            `Scans=${this.scanCount} | ` +
            `LastScan=${this.lastScanMs}ms | ` +
            `Opps: total=${this.oppsFound}, direct=${this.directArbs}, tri=${this.triArbs} | ` +
            `Exec: attempted=${this.execAttempts}, ok=${this.execSuccess}, fail=${this.execFail}`
        );
    }
}
