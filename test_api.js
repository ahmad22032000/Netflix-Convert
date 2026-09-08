const https = require("https");
const qs = require("querystring");
const cookieStr = "NetflixId=ct%3DBgjHlOvcAxL9A-RrexD9yP402ARoFJ3Lny_qzAiokvZPeUEOJC06AMrSejCsA_s2EW-fqh_0t2ptaqOg1ueaVPkAGM4Mq96-bcFbnwQFP8Ppgxk91i9mLMQQ0_ynVLhCsS3neZ3AtmushOkfupbDhxZpL8kY28rI8l1vmwNfWKm72dknzMUrK3ITJWLzeXXZNV9xm3_6KalBu__UnbyC7Rcq-ZvwaTup1-rwAmqc8B8Q_YNlt70umIRqJxUDRL4oqjj6DwFFQYfDdo4V4_gpfiBs4rebaXGqfjJsB1kuR98RaUjD4iQC7n3D2adrQuO3LMV_sQMjiga3pFyRA-cU69kuBjccw3D2Taj_yXoda5nebY-oYfpv3YkLeYt4u_uUax5XiIHwtKIpD7UGD6vIkZXGz_B1Y4E7_2q3MhVSEdy8FJtFimJilM2kpQXI0VYDAIOFhifmm4GB30euhc76U1MXNsHmk8b4I4C6NG5dxWz5EDrzFCEwJHAUGEPQAn2KZdTFdTqWTKOsSs0OTug52NBJWVeZO0cqdq8e5RaxyP0ynmakRCmf9TzDZYi1k2bcdP7q-DAUm01xNpgDSOcraa-pxRj8ag_AefW0slkHJYBLH7f6BzrWeZ0RYdAXEj_ydz6d6jxs101ojQNY-SbQNq2j6kQZ1N3RHwt1jGzQlCaWL_95UFPOGAYiDgoM_LtLt5hCcA0W0XaX%26ch%3DAQEAEAABABQPLA_dDfxARlPMc5Zs5hCJx8AKkc3uk14.%26v%3D3%26pg%3DMTDKG3EFRJCHRH2UNGD2Z6ZS7E;SecureNetflixId=v%3D3%26mac%3DAQEAEQABABQvBEm_ojS4nPoh4MsmsINusXi67UxTDcM.%26dt%3D1787581975076;flwssn=5ece24d9-3a1d-413c-8dff-831a9cc7bcd8;nfvdid=BQFmAAEBEO1PNZw_ondyg3yvFjpjP29gX_BKhaRh_TlVi2IEEdTgRnBPHJlNuAYsnQpbz1ss11-cYEDSNpFTVoA_myk6y4DlruDLNICD9ZqjHzzhialQLW5F55BcVYRNMsipQ7UiMjHsiWmklIx2cCQ3YWaYAvW3;gsid=b261710d-4a22-45ed-9c8a-6c4e350d290d";

function makeRequest(paths) {
    const queryParams = {
        appVersion: "15.48.1",
        device_type: "NFAPPL-02-",
        esn: "NFAPPL-02-IPHONE8=1-PXA-02026U9VV5O8AUKEAEO8PUJETCGDD4PQRI9DEB3MDLEMD0EACM4CS78LMD334MN3MQ3NMJ8SU9O9MVGS6BJCURM1PH1MUTGDPF4S4200",
        idiom: "phone",
        iosVersion: "15.8.5",
        path: JSON.stringify(paths),
        pathFormat: "graph",
        responseFormat: "json"
    };

    const targetUrl = "https://ios.prod.ftl.netflix.com/iosui/user/15.48?" + qs.stringify(queryParams);
    const headers = {
        "User-Agent": "Argo/15.48.1 (iPhone; iOS 15.8.5; Scale/2.00)",
        "Accept": "*/*",
        "Cookie": cookieStr,
        "x-netflix.request.routing": JSON.stringify({"path":"/nq/mobile/nqios/~15.48.0/user","control_tag":"iosui_argo"}),
        "x-netflix.client.type": "argo",
        "x-netflix.client.ftl.esn": "NFAPPL-02-IPHONE8=1-PXA-02026U9VV5O8AUKEAEO8PUJETCGDD4PQRI9DEB3MDLEMD0EACM4CS78LMD334MN3MQ3NMJ8SU9O9MVGS6BJCURM1PH1MUTGDPF4S4200"
    };

    https.get(targetUrl, { headers }, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => console.log(paths[0] + " = " + JSON.stringify(JSON.parse(data).value, null, 2)));
    });
}

makeRequest(["user", "email"]);
makeRequest(["user", "paymentMethod"]);
makeRequest(["profiles", "summary"]);
makeRequest(["account", "paymentMethod"]);
makeRequest(["account", "email"]);
makeRequest(["account", "mobilePhone"]);
makeRequest(["account", "billing"]);

