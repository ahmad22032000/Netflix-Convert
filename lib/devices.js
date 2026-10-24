'use strict';

/**
 * Selectable device targets.
 *
 * One device is generated per request — the caller picks exactly one,
 * we never fan out to three devices at once.
 *
 * The token request itself always uses the same proven iOS/Argo profile
 * (see the generate endpoints). Only the login link path differs per device,
 * so switching device can never break cookie -> token exchange.
 */
const DEVICES = {
    web: {
        id: 'web',
        label: 'Web',
        path: '/',
        buildLink: (token) => `https://netflix.com/?nftoken=${token}`
    },
    mobile: {
        id: 'mobile',
        label: 'Mobile',
        path: '/unsupported',
        buildLink: (token) => `https://netflix.com/unsupported?nftoken=${token}`
    },
    tv: {
        id: 'tv',
        label: 'TV',
        path: '/tv2',
        buildLink: (token) => `https://netflix.com/tv2?nftoken=${token}`
    }
};

const DEFAULT_DEVICE = 'web';

const DEVICE_IDS = Object.keys(DEVICES);

/**
 * Lenient resolver: unknown / missing values fall back to the default device
 * instead of throwing, so a bad value can never error out token generation.
 * The resolved id is always echoed back in the response.
 */
function resolveDevice(value) {
    const key = String(value == null ? '' : value).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(DEVICES, key) ? key : DEFAULT_DEVICE;
}

function buildLink(device, token) {
    return DEVICES[resolveDevice(device)].buildLink(token);
}

module.exports = { DEVICES, DEVICE_IDS, DEFAULT_DEVICE, resolveDevice, buildLink };
