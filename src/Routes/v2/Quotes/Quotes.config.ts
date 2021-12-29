import { Application, Router } from "express";
import CustomerModel from "../../../Database/Schemas/Customers/Customer";
import QuotesModel from "../../../Database/Schemas/Quotes";
import AW from "../../../Lib/AW";
import { APIError, APISuccess } from "../../../Lib/Response";
import EnsureAdmin from "../../../Middlewares/EnsureAdmin";
import QuotesController from "./Quotes.controller";

export default class QuotesRouter
{
    private server: Application;
    private router = Router();

    constructor(server: Application, version: string)
    {
        this.server = server;
        this.server.use(`/${version}/quotes`, this.router);

        this.router.get("/", [
            EnsureAdmin,
            QuotesController.list
        ]);

        this.router.get("/:uid", [
            EnsureAdmin,
            QuotesController.getByUid
        ]);

        this.router.get("/:uid/view", async (req, res) => {
            // 
            const uid = req.params.uid;
            const [quote, e_quote] = await AW(await QuotesModel.findOne({ uid: uid }));

            if(e_quote || !quote)
                return APIError(`Failed to fetch quote with uid ${uid}`)(res);

            const [customer, e_customer] = await AW(CustomerModel.findOne({ $or: [
                { id: quote.customer_uid },
                { uid: quote.customer_uid as any }
            ] }));

            if(e_customer || !customer)
                return APIError(`Failed to fetch customer with uid ${quote.customer_uid}`)(res);

            return APISuccess({
                quote,
                customer
            })(res);
        });

        this.router.post("/", [
            EnsureAdmin,
            QuotesController.insert
        ]);

        this.router.patch("/:uid", [
            EnsureAdmin,
            QuotesController.patch
        ]);

        this.router.put("/:uid", [
            EnsureAdmin,
            QuotesController.patch
        ]);

        this.router.delete("/:uid", [
            EnsureAdmin,
            QuotesController.removeById
        ]);
    }

}