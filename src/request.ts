import https from 'https';
import type { OutgoingHttpHeaders } from 'http';
import { SafeJsonParse } from './util';
import { API_PATH } from './helpers';

const
    DEFAULT_CONNECTION_TIMEOUT = 5000,
    DEFAULT_RETRY_COUNT = 5;

export enum TokenTypes {
    BOT = 'Bot',
    BEARER = 'Bearer',
    NONE = '',
}

export class Authorization {
    private _type: TokenTypes;
    private _token: string;
    private _cache!: string;

    constructor(token: string, type: TokenTypes = TokenTypes.BOT) {
        this._token = token;
        this._type = type;
        this._update();
    }

    _update = () =>
        this._cache = this._type ?
            `${this._type} ${this._token}` :
            this._token;

    get type() { return this._type; };
    set type(value: TokenTypes) { this._type = value; this._update(); };

    get token() { return this._token; };
    set token(value: string) { this._token = value; this._update(); };

    get value() { return this._cache; };
    toString = () => this._cache;
};

const enum Headers {
    ContentType = 'Content-Type',
    ContentLength = 'Content-Length',
    Authorization = 'Authorization',
}

const enum ContentTypes {
    Form = 'application/x-www-form-urlencoded',
    Json = 'application/json',
}

export type RequestOptions = {
    authorization?: Authorization;
    connectionTimeout?: number;
    rateLimit?: {
        retryCount?: number;
        callback?: (response: { message: string; retry_after: number; global: boolean; }, attempts: number) => void;
    };
};

export const Request = (method: string, endpoint: string, options?: RequestOptions, data?: object | string | null) => {
    let content: string;

    const headers: OutgoingHttpHeaders = {};

    if(data) {
        if(typeof data == 'string') {
            headers[Headers.ContentType] = ContentTypes.Form;
            headers[Headers.ContentLength] = Buffer.byteLength(content = data);
        } else {
            headers[Headers.ContentType] = ContentTypes.Json;
            headers[Headers.ContentLength] = Buffer.byteLength(content = JSON.stringify(data));
        }
    }

    if(options?.authorization)
        headers[Headers.Authorization] = options.authorization.toString();

    const requestOptions: https.RequestOptions = {
        method,
        headers,
        timeout: options?.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT,
    };

    return new Promise<any>((resolve, reject) => {
        const
            URL = API_PATH + endpoint,
            retryCount = options?.rateLimit?.retryCount ?? DEFAULT_RETRY_COUNT;

        let attempts = 0;

        const TryRequest = async () => {
            const
                result = await HttpsRequest(URL, requestOptions, content),
                code = result.code;

            if((code >= 200) && (code < 300))
                return resolve(SafeJsonParse(result.data));

            if((code >= 400) && (code < 500)) {
                const response = SafeJsonParse(result.data);
                if(code != 429)
                    return reject({ code, response });

                attempts++;
                options?.rateLimit?.callback?.(response, attempts);

                return (response.retry_after && (attempts < retryCount)) ?
                    setTimeout(TryRequest, Math.ceil(Number(response.retry_after) * 1000)) :
                    reject({ code, response });
            }

            reject({ code });
        };

        TryRequest();
    });
};

const HttpsRequest = (url: string, options: https.RequestOptions, data?: string | Buffer) => {
    return new Promise<{ code: number; data?: string; }>((resolve, reject) => {
        const request = https.request(url, options, (response) => {
            if(!response.statusCode)
                return reject('Unknown response.');

            const ReturnResult = (result?: string) => resolve({ code: response.statusCode!, data: result });

            const chunks: Buffer[] = [];
            let totalLength = 0;

            response.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
                totalLength += chunk.length;
            });

            response.on('end', () => {
                if(!response.complete)
                    return reject('Response error.');

                if(totalLength == 0)
                    return ReturnResult();

                if(chunks.length == 1)
                    return ReturnResult(chunks[0].toString());

                return ReturnResult(Buffer.concat(chunks, totalLength).toString());
            });
        });

        request.on('error', reject);
        request.on('timeout', () => reject('Request timeout.'));

        request.end(data);
    });
};