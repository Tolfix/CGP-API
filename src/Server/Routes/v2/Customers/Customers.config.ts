import { Application, Router } from "express";
import EnsureAdmin from "../../../../Middlewares/EnsureAdmin";
import CustomerController from "./Customers.controller";
import { GetSMTPEmails, JWT_Access_Token } from "../../../../Config";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { APIError, APISuccess } from "../../../../Lib/Response";
import CustomerModel from "../../../../Database/Models/Customers/Customer.model";
import Logger from "../../../../Lib/Logger";
import EnsureAuth from "../../../../Middlewares/EnsureAuth";
import crypto from "crypto";
import PasswordResetModel from "../../../../Database/Models/Customers/PasswordReset.model";
import { SendEmail } from "../../../../Email/Send";
import Footer from "../../../../Email/Templates/General/Footer";
import InvoiceModel from "../../../../Database/Models/Invoices.model";
import OrderModel from "../../../../Database/Models/Orders.model";
import { ICustomer } from "../../../../Interfaces/Customer.interface";
import TransactionsModel from "../../../../Database/Models/Transactions.model";
import { sanitizeMongoose } from "../../../../Lib/Sanitize";
import LoginAttemptTemplate from "../../../../Email/Templates/Customer/LoginAttempt.template";
import ResetPasswordTemplate from "../../../../Email/Templates/Customer/ResetPassword.template";
import OrderCancelTemplate from "../../../../Email/Templates/Customer/OrderCancel.template";
import Header from "../../../../Email/Templates/General/Header";
import MongoFind from "../../../../Lib/MongoFind";
import createPDFInvoice from "../../../../Lib/Invoices/CreatePDFInvoice";

export = class CustomerRouter
{
    private server: Application;
    private router = Router();
    private attemptedLogins = new Map<ICustomer["id"], number>();

    constructor(server: Application, version: string)
    {
        this.server = server;
        this.server.use(`/${version}/customers`, this.router);

        this.router.get("/", [
            EnsureAdmin(),
            CustomerController.list
        ]);

        this.router.get("/my/profile", [
            EnsureAuth(),
            CustomerController.getMyProfile
        ]);

        this.router.get("/my/invoices", EnsureAuth(), async (req, res) =>
        {
            const customer = await CustomerModel.findOne({
                // @ts-ignore
                id: req.customer.id
            });

            if(!customer)
                return APIError(`Unable to find customer`)(res);

            const invoices = await MongoFind(InvoiceModel, req.query, {
                $or: [
                    { customer_uid: customer.uid },
                    { customer_uid: customer.id }
                ]
            });

            res.setHeader("X-Total-Pages", invoices.totalPages);
            res.setHeader("X-Total", invoices.totalCount);

            return APISuccess(invoices.data)(res);
        });

        this.router.get("/my/invoices/:id", EnsureAuth(), async (req, res) =>
        {
            const invoiceId = req.params.id;

            if(!invoiceId)
                return APIError(`Invalid invoice id`)(res);
            
            const customer = await CustomerModel.findOne({
                // @ts-ignore
                id: req.customer.id
            });

            if(!customer)
                return APIError(`Unable to find customer`)(res);

            const data = await MongoFind(InvoiceModel, req.query, {
                // lol almost forgot to add customer_uid kek
                $or: [
                    {
                        customer_uid: customer.uid,
                    },
                    {
                        customer_uid: customer.id,
                    },
                ],
                id: invoiceId,
            });

            if(!data.data)
                return APIError(`Unable to find invoice`)(res);

            return APISuccess(data.data[0])(res);
        });

        this.router.get("/my/invoices/:id/preview", EnsureAuth(), async (req, res) =>
        {
            const invoiceId = req.params.id;

            if(!invoiceId)
                return APIError(`Invalid invoice id`)(res);
            
            const customer = await CustomerModel.findOne({
                // @ts-ignore
                id: req.customer.id
            });

            if(!customer)
                return APIError(`Unable to find customer`)(res);

            const {data: [invoice]} = await MongoFind(InvoiceModel, req.query, {
                // lol almost forgot to add customer_uid kek
                $or: [
                    {
                        customer_uid: customer.uid,
                    },
                    {
                        customer_uid: customer.id,
                    },
                ],
                id: invoiceId,
            });

            if(!invoice)
                return APIError(`Unable to find invoice`)(res);

            const result = await createPDFInvoice(invoice);

            res.writeHead(200, {
                'Content-Type': "application/pdf",
            });

            return res.end(result, "base64");
        });

        this.router.get("/my/orders", EnsureAuth(), async (req, res) =>
        {
            const customer = await CustomerModel.findOne({
                // @ts-ignore
                id: req.customer.id
            });

            if(!customer)
                return APIError(`Unable to find customer`)(res);

            const data = await MongoFind(OrderModel, req.query,{
                $or: [
                    { customer_uid: customer.uid },
                    { customer_uid: customer.id }
                ]
            });

            res.setHeader("X-Total-Pages", data.totalPages);
            res.setHeader("X-Total", data.totalCount);

            return APISuccess(data.data)(res);
        });

        this.router.get("/my/orders/:id", EnsureAuth(), async (req, res) =>
        {
            const orderId = req.params.id;

            if(!orderId)
                return APIError(`Invalid invoice id`)(res);
            
            const customer = await CustomerModel.findOne({
                // @ts-ignore
                id: req.customer.id
            });

            if(!customer)
                return APIError(`Unable to find customer`)(res);

            const {data: [order]} = await MongoFind(OrderModel, req.query,{
                $or: [
                    {
                        customer_uid: customer.uid,
                    },
                    {
                        customer_uid: customer.id,
                    },
                ],
                id: orderId,
            });

            if(!order)
                return APIError(`Unable to find order`)(res);

            return APISuccess(order)(res);
        });

        this.router.post("/my/orders/:id/cancel", EnsureAuth(), async (req, res) =>
        {
            const orderId = req.params.id;

            if(!orderId)
                return APIError(`Invalid invoice id`)(res);
            
            const customer = await CustomerModel.findOne({
                // @ts-ignore
                id: req.customer.id
            });

            if(!customer)
                return APIError(`Unable to find customer`)(res);

            const order = await OrderModel.findOne({
                $or: [
                    {
                        customer_uid: customer.uid,
                    },
                    {
                        customer_uid: customer.id,
                    },
                ],
                id: orderId,
                // remove cancelled orders
                order_status: {
                    $ne: "cancelled"
                }
            });

            if(!order)
                return APIError(`Unable to find order`)(res);

            order.order_status = "cancelled";
            await order.save();

            SendEmail(customer.personal.email, "Order Cancelled Confirmation", {
                isHTML: true,
                body: await OrderCancelTemplate(customer, order),
            });

            GetSMTPEmails().then(emails =>
            {
                for(const email of emails)
                {
                    SendEmail(email, `Order Cancelled #${order.id}`, {
                        isHTML: true,
                        body: `
                            <h1>Order Cancelled</h1>
                            <p>Order #${order.id} has been cancelled</p>
                        `,
                    });
                }
            });

            return APISuccess("Order cancelled.")(res);
        });

        this.router.get("/my/transactions", EnsureAuth(), async (req, res) =>
        {
            const customer = await CustomerModel.findOne({
                // @ts-ignore
                id: req.customer.id
            });

            if(!customer)
                return APIError(`Unable to find customer`)(res);

            const {data: transactions, totalCount, totalPages} = await MongoFind(TransactionsModel, req.query,{
                $or: [
                    // { customer_uid: customer.uid },
                    { customer_uid: customer.id }
                ]
            });

            res.setHeader("X-Total-Pages", totalPages);
            res.setHeader("X-Total", totalCount);

            return APISuccess(transactions)(res);
        });

        this.router.get("/my/transactions/:id", EnsureAuth(), async (req, res) =>
        {
            const transactionId = req.params.id;

            if(!transactionId)
                return APIError(`Invalid transaction id`)(res);
            
            const customer = await CustomerModel.findOne({
                // @ts-ignore
                id: req.customer.id
            });

            if(!customer)
                return APIError(`Unable to find customer`)(res);

            const {data: [transactions]} = await MongoFind(TransactionsModel, req.query,{
                $or: [
                    {
                        customer_uid: customer.uid,
                    },
                    {
                        customer_uid: customer.id,
                    },
                ],
                id: transactionId,
            });

            return APISuccess(transactions)(res);
        });

        this.router.post("/my/reset-password", async (req, res) =>
        {
            const email = req.body.email;

            if(!email)
                return APIError(`Invalid email`)(res);

            const customer = await CustomerModel.findOne({ "personal.email": sanitizeMongoose(email) });
            if(!customer)
                return APIError(`Unable to find user with email ${email}`)(res);

            const randomToken = crypto.randomBytes(20).toString("hex");
            const token = crypto.createHash("sha256").update(randomToken).digest("hex");

            new PasswordResetModel({
                email: customer.personal.email,
                token: token
            }).save();

            SendEmail(customer.personal.email, "Reset Password", {
                isHTML: true,
                body: await ResetPasswordTemplate(customer, version, token)
            });

            return APISuccess(`Succesfully created a reset password email`)(res);
        });

        this.router.get("/my/reset-password/:token", async (req, res) =>
        {
            const token = req.params.token;
            const passwordReset = await PasswordResetModel.findOne({ token: token }) as any;
            if(!passwordReset)
                return APIError(`Unable to find password reset token`)(res);
            
            if(!passwordReset.token)
                return APIError(`Unable to find password reset token`)(res);

            if(passwordReset.used)
                return APIError(`This password reset token has already been used`)(res);
            
            const customer = await CustomerModel.findOne({ "personal.email": passwordReset.email });
            if(!customer)
                return APIError(`Unable to find user with email ${passwordReset.email}`)(res);

            return res.send(`
            <!-- Style it in the middle -->
            <style>
                .container {
                    width: 100%;
                    height: 100%;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }
                /* Style input forms */
                .form-container {
                    flex-direction: column;
                    margin: 0 auto;
                }
                .form-container input {
                    width: 20%;
                    height: 40px;
                    border: 1px solid #ccc;
                    border-radius: 5px;
                    padding: 5px;
                    margin-bottom: 10px;
                }
                .form-container button {
                    width: 20%;
                    height: 40px;
                    border: 1px solid #ccc;
                    border-radius: 5px;
                    padding: 5px;
                    margin-bottom: 10px;
                }
            </style>
            <html>
                <body>
                    ${await Header()}
                    <form class="container form-container" action="/${version}/customers/my/new-password?token=${token}" method="POST">
                        <input type="password" name="password" placeholder="New Password" />
                        <input type="password" name="password_confirmation" placeholder="Confirm Password" />
                        <button type="submit" value="Submit">Reset password</button>
                    </form>
                    ${Footer}
                </body>
            </html>
            `);
        });

        this.router.post("/my/new-password", async (req, res) =>
        {
            const token = req.query.token;
            const password = req.body.password;

            if(!password)
                return APIError(`Password is required`)(res);
            
            if(!token)
                return APIError(`Token is required`)(res);

            const passwordReset = await PasswordResetModel.findOne({ token: sanitizeMongoose(token) }) as any;
            if(!passwordReset)
                return APIError(`Unable to find password reset token`)(res);
            
            if(!passwordReset.token)
                return APIError(`Unable to find password reset token`)(res);

            if(passwordReset.used)
                return APIError(`This password reset token has already been used`)(res);
            
            const customer = await CustomerModel.findOne({ "personal.email": passwordReset.email });
            if(!customer)
                return APIError(`Unable to find user with email ${passwordReset.email}`)(res);

            const genSalt = await bcrypt.genSalt(10);
            customer.password = bcrypt.hashSync(password, genSalt);
            await customer.save();
            passwordReset.used = true;
            await passwordReset.save();
            res.send(`
            <style>
                .container {
                    width: 100%;
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                }
            </style>
            <html>
                <body class="container">
                    ${await Header()}
                    <h1>Password reset successful</h1>
                    <div>
                        <p>You can now login with your new password</p>
                    </div>
                    ${Footer}
                </body>
            </html>
            `);
        });
        
        this.router.get("/:uid", [
            EnsureAdmin(),
            CustomerController.getByUid
        ]);

        this.router.post("/", [
            // EnsureAdmin(),
            CustomerController.insert
        ]);

        this.router.patch("/:uid", [
            EnsureAdmin(),
            CustomerController.patch
        ]);

        this.router.put("/:uid", [
            EnsureAdmin(),
            CustomerController.patch
        ]);

        this.router.delete("/:uid", [
            EnsureAdmin(),
            CustomerController.removeById
        ]);

        this.router.post("/authenticate", async (req, res) =>
        {
            
            const { username, password } = req.body;
            
            Logger.info(`Authenticating user ${username}`);

            if(!username || !password)
                return APIError("Please include username and password in body.")(res);
            
            const customer = await CustomerModel.findOne({ "personal.email": sanitizeMongoose(username) });

            if(!customer)
                return APIError("Invalid email or password.")(res);

            // @ts-ignore
            const isCorrect = await bcrypt.compare(password.toString(), customer.password)

            if(!isCorrect)
            {
                if(this.attemptedLogins.has(customer.id))
                {
                    const attempts = this.attemptedLogins.get(customer.id);
                    if(attempts)
                    {
                        if(attempts >= 3)
                        {
                            SendEmail(customer.personal.email, "Account login attempts", {
                                isHTML: true,
                                body: await LoginAttemptTemplate(customer),
                            });
                            this.attemptedLogins.delete(customer.id);
                        }
                        else
                            this.attemptedLogins.set(customer.id, attempts + 1);
                    }
                }
                else
                    this.attemptedLogins.set(customer.id, 1);
                return APIError("Invalid email or password.")(res);
            }

            const token = jwt.sign({
                data: {
                    id: customer.id,
                    email: customer.personal.email,
                },
                exp: Math.floor(Date.now() / 1000) + (((60 * 60)*24))
            }, JWT_Access_Token);
            return APISuccess({
                text: "Succesfully created customer token",
                expires: "7 days",
                token: token,
            })(res);
        });

    }

}