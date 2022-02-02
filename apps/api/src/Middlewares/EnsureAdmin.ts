import { Request, Response, NextFunction } from "express"
import bcrypt from "bcryptjs";
import { CacheAdmin, getAdminByUsername } from "../Cache/Admin.cache";
import { APIError } from "../Lib/Response";
import jwt from "jsonwebtoken";
import { JWT_Access_Token } from "../Config";
import Logger from "../Lib/Logger";

export default function EnsureAdmin(eR = false)
{
    return (req: Request, res: Response, next?: NextFunction) =>
    {

        const authHeader = req.headers['authorization'];
        if(!authHeader)
            return eR ? Promise.resolve(false) : APIError("Missing 'authorization' in header")(res);
    
        const b64auth = (authHeader).split(' ');
    
        if(!b64auth[0].toLocaleLowerCase().match(/basic|bearer/g))
            return eR ? Promise.resolve(false) : APIError("Missing 'basic' or 'bearer' in authorization")(res);
    
        if(!b64auth[1])
            return eR ? Promise.resolve(false) : APIError("Missing 'buffer' in authorization")(res);
    
        if(b64auth[0].toLocaleLowerCase() === "basic")
        {
            // Check if buffer, or base64
            let [login, password] = (Buffer.isBuffer(b64auth[1]) ? Buffer.from(b64auth[1], 'base64') : b64auth[1]).toString().split(':');
            if(login.includes("==") || password.includes("=="))
            {
                // Assuming base64 string
                // Convert it to normal string
                Logger.error(`Admin authorizing with base64 string`);
                Logger.info(`Encoding admin credentials to normal string`);
                login = atob(login);
                password = login.split(":")[1];
                login = login.split(":")[0];
            }
            
            eR ? null : Logger.warning(`Authoring admin with username: ${login}`);
    
            const match = bcrypt.compare(password, (CacheAdmin.get(getAdminByUsername(login) ?? "ADM_")?.["password"]) ?? "")
            if(!match)
            {
                eR ? null : Logger.warning(`Authorization failed for admin with username: ${login}`);
                return eR ? Promise.resolve(false) : APIError("Unauthorized admin", 403)(res);
            }
    
            return eR ? Promise.resolve(true) : next?.();
        }
    
        if(b64auth[0].toLocaleLowerCase() === "bearer")
        {
            const token = (Buffer.isBuffer(b64auth[1]) ? Buffer.from(b64auth[1], 'base64') : b64auth[1]).toString();
            eR ? null : Logger.warning(`Authoring admin with token: ${token}`);
            const payload = jwt.verify(token, JWT_Access_Token);
            if(!payload)
            {
                eR ? null : Logger.warning(`Authorization failed for admin with token: ${token}`);
                return eR ? Promise.resolve(false) : APIError("Unauthorized admin", 403)(res);
            }

            eR ? null : Logger.warning(`Authorized admin with token: ${token}`);

            return eR ? Promise.resolve(true) : next?.();
        }

        return Promise.resolve(false);
    }
}