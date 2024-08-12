import Fastify from 'fastify'
import { DefaultAzureCredential, logger } from '@azure/identity'
import { CosmosClient } from '@azure/cosmos'
import { randomUUID } from 'crypto'
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import { ContainerAppsAPIClient } from '@azure/arm-appcontainers'

const credential = new DefaultAzureCredential()
const cosmosClient = new CosmosClient({
    endpoint: process.env.COSMOSDB_ENDPOINT,
    aadCredentials: credential
})

const processorJobName = process.env.JOB_NAME
const resourceGroupName = process.env.RESOURCE_GROUP_NAME
const subscriptionId = process.env.SUBSCRIPTION_ID
const containerAppsClient = new ContainerAppsAPIClient(credential, subscriptionId)

const database = cosmosClient.database('async-api')
const container = database.container('statuses')

const fastify = Fastify({
    logger: true
})


fastify.post('/orders', async (request, reply) => {
    const orderId = randomUUID()
    await container.items.create({
        id: orderId,
        status: 'pending',
        order: request.body,
    })

    const { template: processorJobTemplate } = await containerAppsClient.jobs.get(resourceGroupName, processorJobName)
    const environmentVariables = processorJobTemplate.containers[0].env
    environmentVariables.push({ name: 'ORDER_ID', value: orderId })
    const jobStartTemplate = { template: processorJobTemplate }

    console.log(JSON.stringify(jobStartTemplate, null, 2))
    const jobExecution = await containerAppsClient.jobs.beginStartAndWait(resourceGroupName, processorJobName, {
        template: processorJobTemplate,
    })

    console.log(`Job ${jobExecution.name} started`)

    reply.code(202).header('Location', '/orders/status/' + orderId).send()
})

fastify.get('/orders/status/:orderId', async (request, reply) => {
    const { orderId } = request.params
    const { resource: item } = await container.item(orderId, orderId).read()

    if (item === undefined) {
        reply.code(404).send()
        return
    }

    if (item.status === 'pending') {
        reply.code(200).headers({
            'Retry-After': 10,
        }).send({ status: item.status })
    } else {
        reply.code(303).header('Location', '/orders/' + orderId).send()
    }
})

fastify.get('/orders/:orderId', async (request, reply) => {
    const { orderId } = request.params
    const { resource: item } = await container.item(orderId, orderId).read()

    if (item === undefined || item.status === 'pending') {
        reply.code(404).send()
        return
    }

    if (item.status === 'completed') {
        reply.code(200).send({ id: item.id, status: item.status, order: item.order })
    } else if (item.status === 'failed') {
        reply.code(500).send({ id: item.id, status: item.status, error: item.error })
    }
})

// serve static files from /public
fastify.register(fastifyStatic, {
    root: path.join(import.meta.dirname, 'public'),
})

fastify.listen({ host: '0.0.0.0', port: 3000 }, function (err, address) {
    if (err) {
        fastify.log.error(err)
        process.exit(1)
    }
})