export {};
declare global {
	const OVERRIDES: Record<string, string>;
	const proj4: any;
	interface Window {
		StationInfo: any;
		SunCalc: any;
		applyScanlineScaling: any;
		currentScale: number;
		WS4KP_SERVER_AVAILABLE: boolean;
	}
}
