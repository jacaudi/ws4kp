import updateVendor from './gulp/update-vendor.mjs';
import buildDist, { buildDevIndex, watchDev } from './gulp/build.mjs';

export default buildDist;

export {
	updateVendor,
	buildDist,
	buildDevIndex,
	watchDev as watch,
};
