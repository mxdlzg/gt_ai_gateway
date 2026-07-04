import { SgVendor } from "../model/sgVendor";
import { ApiFormat } from "../constants";
import headerFingerprintService from "./headerFingerprintService";


async function getVendorByName(name: string): Promise<SgVendor | null> {
    if (name == null) {
        return null;
    }

    return await SgVendor.query().where("name", name).first();
}


async function updateVendor(
    vendorId: number,
    data: { type?: string; name?: string; token?: string; urls?: Record<string, string>; headers?: Record<string, string>; header_fingerprint?: string; proxy_url?: string; skip_tls_verify?: boolean },
): Promise<SgVendor | null> {
    const vendor = await SgVendor.query().find(vendorId);

    if (!vendor) {
        return null;
    }

    const updateData: any = {
        type: data.type ?? vendor.type,
        name: data.name ?? vendor.name,
        token: data.token ?? vendor.token,
    };

    // Handle urls - if provided, serialize as JSON string
    if (data.urls !== undefined) {
        updateData.urls = JSON.stringify(data.urls);
    }

    if (data.headers !== undefined) {
        updateData.headers = JSON.stringify(data.headers);
    }

    if (data.header_fingerprint !== undefined) {
        updateData.header_fingerprint = headerFingerprintService.normalizeVendorSetting(data.header_fingerprint);
    }

    if (data.proxy_url !== undefined) {
        updateData.proxy_url = data.proxy_url.trim();
    }

    if (data.skip_tls_verify !== undefined) {
        updateData.skip_tls_verify = data.skip_tls_verify === true ? 1 : 0;
    }

    await SgVendor.query()
        .where("id", vendorId)
        .update(updateData);

    return await SgVendor.query().find(vendorId);
}

async function findVendorByUrl(gatewayUrl: string, protocol: ApiFormat): Promise<number | null> {
    if (!gatewayUrl) return null;

    const vendors = await SgVendor.query().get();
    for (const vendor of vendors) {
        const mergedUrls = vendor.getMergedUrls();
        let vendorUrl: string | undefined;

        if (protocol === ApiFormat.RESPONSES) {
            vendorUrl = mergedUrls[ApiFormat.RESPONSES] || mergedUrls[ApiFormat.OPENAI];
        } else {
            vendorUrl = mergedUrls[protocol];
        }

        if (vendorUrl && gatewayUrl.startsWith(vendorUrl)) {
            return Number(vendor.id);
        }
    }

    return null;
}


export default {
    getVendorByName,
    updateVendor,
    findVendorByUrl,
};
