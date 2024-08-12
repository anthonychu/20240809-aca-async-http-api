## Deployment script

```bash
export RESOURCE_GROUP_NAME=aca-async-http-api
export SUBSCRIPTION_ID=$(az account show --query id --output tsv)
export JOB_NAME=processor-job
COSMOS_DB_ACCOUNT_NAME=aca-async-http-api
ENVIRONMENT_NAME=aca-async-http-api
APP_NAME=http-api
ACR_NAME=acaasynchttpapi
LOCATION=westus

az group create --name $RESOURCE_GROUP_NAME --location $LOCATION

# Create a Cosmos DB account (serverless)
az cosmosdb create --name $COSMOS_DB_ACCOUNT_NAME --resource-group $RESOURCE_GROUP_NAME --capabilities EnableServerless

az cosmosdb sql database create --account-name $COSMOS_DB_ACCOUNT_NAME --name async-api --resource-group $RESOURCE_GROUP_NAME

az cosmosdb sql container create --account-name $COSMOS_DB_ACCOUNT_NAME --database-name async-api --name statuses --partition-key-path /id --resource-group $RESOURCE_GROUP_NAME

# assign role to the current user
az cosmosdb sql role assignment create --account-name $COSMOS_DB_ACCOUNT_NAME --role-definition-name "Cosmos DB Built-in Data Contributor" --resource-group $RESOURCE_GROUP_NAME --scope /dbs/async-api --principal-id $(az ad signed-in-user show --query id --output tsv)

export COSMOSDB_ENDPOINT=$(az cosmosdb show --name $COSMOS_DB_ACCOUNT_NAME --resource-group $RESOURCE_GROUP_NAME --query documentEndpoint --output tsv)

# create Container Apps environment
az containerapp env create -n $ENVIRONMENT_NAME -g $RESOURCE_GROUP_NAME -l $LOCATION --mi-system-assigned

# create a registry
az acr create --name $ACR_NAME --resource-group $RESOURCE_GROUP_NAME --location $LOCATION --sku Basic

# build and push the image
az acr build --registry $ACR_NAME --image aca-async-http-api:1.0 .

# assign acrPull role to the environment's system-assigned identity
az role assignment create --role acrpull --assignee $(az containerapp env show -n $ENVIRONMENT_NAME -g $RESOURCE_GROUP_NAME --query identity.principalId --output tsv) --scope $(az acr show -n $ACR_NAME -g $RESOURCE_GROUP_NAME --query id --output tsv)

# create a user-assigned identity
az identity create -n "$ENVIRONMENT_NAME-identity" -g $RESOURCE_GROUP_NAME

USER_IDENTITY_PRINCIPAL_ID=$(az identity show -n "$ENVIRONMENT_NAME-identity" -g $RESOURCE_GROUP_NAME --query principalId --output tsv)

USER_IDENTITY_ID=$(az identity show -n "$ENVIRONMENT_NAME-identity" -g $RESOURCE_GROUP_NAME --query id --output tsv)

USER_IDENTITY_CLIENT_ID=$(az identity show -n "$ENVIRONMENT_NAME-identity" -g $RESOURCE_GROUP_NAME --query clientId --output tsv)

# assign acrPull role to the user-assigned identity
az role assignment create --role acrpull --assignee-object-id $USER_IDENTITY_PRINCIPAL_ID --assignee-principal-type ServicePrincipal --scope $(az acr show -n $ACR_NAME -g $RESOURCE_GROUP_NAME --query id --output tsv)

az cosmosdb sql role assignment create --account-name $COSMOS_DB_ACCOUNT_NAME --role-definition-name "Cosmos DB Built-in Data Contributor" --resource-group $RESOURCE_GROUP_NAME --scope /dbs/async-api --principal-id $USER_IDENTITY_PRINCIPAL_ID

az containerapp job create -n $JOB_NAME -g $RESOURCE_GROUP_NAME --environment $ENVIRONMENT_NAME --image $ACR_NAME.azurecr.io/aca-async-http-api:1.0 --command 'npm' 'run' 'start:job' --cpu 0.5 --memory 1Gi --env-vars "COSMOSDB_ENDPOINT=$COSMOSDB_ENDPOINT" "AZURE_CLIENT_ID=$USER_IDENTITY_CLIENT_ID" --trigger-type Manual --registry-identity $USER_IDENTITY_ID --registry-server $ACR_NAME.azurecr.io --mi-user-assigned $USER_IDENTITY_ID

az containerapp create -n $APP_NAME -g $RESOURCE_GROUP_NAME --environment $ENVIRONMENT_NAME --image $ACR_NAME.azurecr.io/aca-async-http-api:1.0 --cpu 0.5 --memory 1Gi --env-vars "COSMOSDB_ENDPOINT=$COSMOSDB_ENDPOINT" "AZURE_CLIENT_ID=$USER_IDENTITY_CLIENT_ID" "SUBSCRIPTION_ID=$SUBSCRIPTION_ID" "RESOURCE_GROUP_NAME=$RESOURCE_GROUP_NAME" "JOB_NAME=$JOB_NAME" --registry-identity $USER_IDENTITY_ID --registry-server $ACR_NAME.azurecr.io  --user-assigned $USER_IDENTITY_ID --ingress external --target-port 3000

# give the user-assigned identity the contributor role to the job so it can start the job
az role assignment create --role "Contributor" --assignee-object-id $USER_IDENTITY_PRINCIPAL_ID --assignee-principal-type ServicePrincipal --scope $(az containerapp job show -n $JOB_NAME -g $RESOURCE_GROUP_NAME --query id --output tsv)
```