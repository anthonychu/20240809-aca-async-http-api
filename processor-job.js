import { DefaultAzureCredential } from '@azure/identity'
import { CosmosClient } from '@azure/cosmos'

const credential = new DefaultAzureCredential()
const client = new CosmosClient({ 
    endpoint: process.env.COSMOSDB_ENDPOINT, 
    aadCredentials: credential
})

const database = client.database('async-api')
const container = database.container('statuses')

const orderId = process.env.ORDER_ID

const orderItem = await container.item(orderId, orderId).read()
const orderResource = orderItem.resource

if (orderResource === undefined) {
    console.error('Order not found')
    orderResource.status = 'failed'
    await orderItem.item.replace(orderResource)
    process.exit(1)
}

const orderProcessingTime = Math.floor(Math.random() * 30000)
console.log(`Processing order ${orderId} for ${orderProcessingTime}ms`)
await new Promise(resolve => setTimeout(resolve, orderProcessingTime))

orderResource.status = 'completed'
orderResource.order.completedAt = new Date().toISOString()
await orderItem.item.replace(orderResource)
console.log(`Order ${orderId} processed`)
