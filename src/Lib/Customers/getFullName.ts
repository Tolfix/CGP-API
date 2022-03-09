import { ICustomer } from "@interface/Customer.interface";

export default (customer: ICustomer) => `${customer.personal.first_name} ${customer.personal.last_name}${customer.billing.company ? ` (${customer.billing.company})` : ''}`; 