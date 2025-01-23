/*
 * Copyright 2020 Google LLC. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.google.mlkit.vision.demo.kotlin

import android.content.Intent
import android.os.Build.VERSION_CODES
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.AdapterView
import android.widget.AdapterView.OnItemSelectedListener
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CompoundButton
import android.widget.EditText
import android.widget.ImageView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import android.widget.ToggleButton
import androidx.annotation.RequiresApi
import androidx.camera.core.Camera
import androidx.camera.core.CameraInfoUnavailableException
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Observer
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.common.annotation.KeepName
import com.google.gson.Gson
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.demo.CameraXViewModel
import com.google.mlkit.vision.demo.GraphicOverlay
import com.google.mlkit.vision.demo.R
import com.google.mlkit.vision.demo.R.id.detectedText
import com.google.mlkit.vision.demo.VisionImageProcessor
import com.google.mlkit.vision.demo.kotlin.textdetector.TextRecognitionProcessor
import com.google.mlkit.vision.demo.preference.PreferenceUtils
import com.google.mlkit.vision.demo.preference.SettingsActivity
import com.google.mlkit.vision.demo.preference.SettingsActivity.LaunchSource
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** Live preview demo app for ML Kit APIs using CameraX. */
@KeepName
@RequiresApi(VERSION_CODES.LOLLIPOP)
class CameraXLivePreviewActivity :
  AppCompatActivity(), OnItemSelectedListener, CompoundButton.OnCheckedChangeListener {

  private var previewView: PreviewView? = null
  private var graphicOverlay: GraphicOverlay? = null
  private var cameraProvider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var previewUseCase: Preview? = null
  private var analysisUseCase: ImageAnalysis? = null
  private var imageProcessor: VisionImageProcessor? = null
  private var needUpdateGraphicOverlayImageSourceInfo = false
  private var selectedModel = OBJECT_DETECTION
  private var lensFacing = CameraSelector.LENS_FACING_BACK
  private var cameraSelector: CameraSelector? = null
  private var textInputField : EditText? = null
  private var textViewField : TextView? = null
  private var ip : String? = null
  private var chargingStationId : String? = null
  private var apiEndpoint : String? = null
  private var chargerId : String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    Log.d(TAG, "onCreate")
    if (savedInstanceState != null) {
      selectedModel = savedInstanceState.getString(STATE_SELECTED_MODEL, OBJECT_DETECTION)
    }
    cameraSelector = CameraSelector.Builder().requireLensFacing(lensFacing).build()
    setContentView(R.layout.activity_vision_camerax_live_preview)
    previewView = findViewById(R.id.preview_view)
    if (previewView == null) {
      Log.d(TAG, "previewView is null")
    }
    graphicOverlay = findViewById(R.id.graphic_overlay)
    if (graphicOverlay == null) {
      Log.d(TAG, "graphicOverlay is null")
    }

    textInputField = findViewById(detectedText)
    if (textInputField == null) {
      Log.d(TAG, "textInputField is null")
    }

    textViewField = findViewById(R.id.detectedTextView)
    if (textViewField == null) {
      Log.d(TAG, "textViewField is null")
    }

    val spinner = findViewById<Spinner>(R.id.spinner)
    val options: MutableList<String> = ArrayList()

    options.add(TEXT_RECOGNITION_LATIN)

    // Creating adapter for spinner
    val dataAdapter = ArrayAdapter(this, R.layout.spinner_style, options)
    // Drop down layout style - list view with radio button
    dataAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
    // attaching data adapter to spinner
    spinner.adapter = dataAdapter
    spinner.onItemSelectedListener = this
    val facingSwitch = findViewById<ToggleButton>(R.id.facing_switch)
    facingSwitch.setOnCheckedChangeListener(this)
    ViewModelProvider(this, ViewModelProvider.AndroidViewModelFactory.getInstance(application))
      .get(CameraXViewModel::class.java)
      .processCameraProvider
      .observe(
        this,
        Observer { provider: ProcessCameraProvider? ->
          cameraProvider = provider
          bindAllCameraUseCases()
        },
      )

    val settingsButton = findViewById<ImageView>(R.id.settings_button)
    settingsButton.setOnClickListener {
      val intent = Intent(applicationContext, SettingsActivity::class.java)
      intent.putExtra(SettingsActivity.EXTRA_LAUNCH_SOURCE, LaunchSource.CAMERAX_LIVE_PREVIEW)
      startActivity(intent)
    }

    val apiButton = findViewById<Button>(R.id.sendToApiButtonVisionCameraxLivePreview)
    apiButton.setOnClickListener {
      lifecycleScope.launch(Dispatchers.IO) {
        sendLicense()
      }
    }
  }

  private suspend fun sendLicense(){
    ip = intent.getStringExtra("ip")
    chargingStationId = intent.getStringExtra("chargingStationId")
    chargerId = intent.getStringExtra("chargerId")
    apiEndpoint = intent.getStringExtra("apiEndpoint")
    val licensePlateNumber = findViewById<EditText>(detectedText).text.toString()
    val loginUrlString = "http://$ip/api/login"
    val apiUrl = "http://$ip/api/$apiEndpoint"
    Log.d("APICALL", "Calling $loginUrlString")
    withContext(Dispatchers.IO){
      try {
        val url : URL = URI.create(apiUrl).toURL()
        val loginUrl : URL = URI.create(loginUrlString).toURL()
        val loginConnection :  HttpURLConnection = loginUrl.openConnection() as HttpURLConnection
        val connection : HttpURLConnection = url.openConnection() as HttpURLConnection
        val response = StringBuilder()

        loginConnection.requestMethod = "POST"

        // Send request body for POST/PUT methods
        loginConnection.doOutput = true
        val loginRequestBody = mapOf(
          "username" to "infra",
          "password" to "infra"
        )

        loginRequestBody.let {
          val jsonInput = Gson().toJson(it)
          OutputStreamWriter(loginConnection.outputStream).use { os ->
            os.write(jsonInput)
            os.flush()
          }
        }

        // Handle the response
        val loginResponseCode = loginConnection.responseCode
        val bearerToken = loginConnection.getHeaderField("set-cookie").split(';')[0].replace("bearerToken=", "Bearer ")
        if (loginResponseCode == HttpURLConnection.HTTP_OK || loginResponseCode == HttpURLConnection.HTTP_CREATED) {
          BufferedReader(InputStreamReader(loginConnection.inputStream, "utf-8")).use { br ->
            var responseLine: String?
            while (br.readLine().also { responseLine = it } != null) {
              response.append(responseLine?.trim())
            }
            Log.d("APICALL_LOGIN", response.toString())
//            Handler(Looper.getMainLooper()).post {
//              val toast = Toast.makeText(
//                applicationContext,
//                "Data sent successfully to API" + response.toString(),
//                Toast.LENGTH_LONG)
//              toast.setGravity(Gravity.CENTER, 0, 0)
//              toast.show()
//            }
          }
        } else {
          // Handle error response
          BufferedReader(InputStreamReader(loginConnection.errorStream, "utf-8")).use { br ->
            var responseLine: String?
            while (br.readLine().also { responseLine = it } != null) {
              response.append(responseLine?.trim())
            }
            Log.d("APICALL", response.toString())
          }
          println("Error Response Code: $loginResponseCode, Message: ${loginConnection.responseMessage}")
          Handler(Looper.getMainLooper()).post {
            val toast = Toast.makeText(
              applicationContext,
              "Error sending to API",
              Toast.LENGTH_LONG)
            toast.setGravity(Gravity.CENTER, 0, 0)
            toast.show()
          }
        }

        connection.requestMethod = "POST"

        // Send request body for POST/PUT methods
        connection.doOutput = true
        connection.setRequestProperty("Authorization", bearerToken);
        val requestBody = mapOf(
          "licensePlate" to licensePlateNumber,
          "chargingStationId" to chargingStationId,
          "chargerId" to chargerId
        )

        requestBody.let {
          val jsonInput = Gson().toJson(it)
          OutputStreamWriter(connection.outputStream).use { os ->
            os.write(jsonInput)
            os.flush()
          }
        }

        // Handle the response
        val responseCode = connection.responseCode
        if (responseCode == HttpURLConnection.HTTP_OK || responseCode == HttpURLConnection.HTTP_CREATED) {
          BufferedReader(InputStreamReader(connection.inputStream, "utf-8")).use { br ->
            var responseLine: String?
            while (br.readLine().also { responseLine = it } != null) {
              response.append(responseLine?.trim())
            }
            Log.d("APICALL", response.toString())
            Handler(Looper.getMainLooper()).post {
              val toast = Toast.makeText(
                applicationContext,
                "Data sent successfully to API" + response.toString(),
                Toast.LENGTH_LONG)
              toast.setGravity(Gravity.CENTER, 0, 0)
              toast.show()
            }
          }
        } else {
          // Handle error response
          BufferedReader(InputStreamReader(connection.errorStream, "utf-8")).use { br ->
            var responseLine: String?
            while (br.readLine().also { responseLine = it } != null) {
              response.append(responseLine?.trim())
            }
            Log.d("APICALL", response.toString())
          }
          println("Error Response Code: $responseCode, Message: ${connection.responseMessage}")
          Handler(Looper.getMainLooper()).post {
            val toast = Toast.makeText(
              applicationContext,
              "Error sending to API",
              Toast.LENGTH_LONG)
            toast.setGravity(Gravity.CENTER, 0, 0)
            toast.show()
          }
        }
      } catch (e: Exception) {
        e.printStackTrace()
      }
    }
  }

  override fun onSaveInstanceState(bundle: Bundle) {
    super.onSaveInstanceState(bundle)
    bundle.putString(STATE_SELECTED_MODEL, selectedModel)
  }

  @Synchronized
  override fun onItemSelected(parent: AdapterView<*>?, view: View?, pos: Int, id: Long) {
    // An item was selected. You can retrieve the selected item using
    // parent.getItemAtPosition(pos)
    selectedModel = parent?.getItemAtPosition(pos).toString()
    Log.d(TAG, "Selected model: $selectedModel")
    bindAnalysisUseCase()
  }

  override fun onNothingSelected(parent: AdapterView<*>?) {
    // Do nothing.
  }

  override fun onCheckedChanged(buttonView: CompoundButton, isChecked: Boolean) {
    if (cameraProvider == null) {
      return
    }
    val newLensFacing =
      if (lensFacing == CameraSelector.LENS_FACING_FRONT) {
        CameraSelector.LENS_FACING_BACK
      } else {
        CameraSelector.LENS_FACING_FRONT
      }
    val newCameraSelector = CameraSelector.Builder().requireLensFacing(newLensFacing).build()
    try {
      if (cameraProvider!!.hasCamera(newCameraSelector)) {
        Log.d(TAG, "Set facing to " + newLensFacing)
        lensFacing = newLensFacing
        cameraSelector = newCameraSelector
        bindAllCameraUseCases()
        return
      }
    } catch (e: CameraInfoUnavailableException) {
      // Falls through
    }
    Toast.makeText(
        applicationContext,
        "This device does not have lens with facing: $newLensFacing",
        Toast.LENGTH_SHORT,
      )
      .show()
  }

  public override fun onResume() {
    super.onResume()
    bindAllCameraUseCases()
  }

  override fun onPause() {
    super.onPause()

    imageProcessor?.run { this.stop() }
  }

  public override fun onDestroy() {
    super.onDestroy()
    imageProcessor?.run { this.stop() }
  }

  private fun bindAllCameraUseCases() {
    if (cameraProvider != null) {
      // As required by CameraX API, unbinds all use cases before trying to re-bind any of them.
      cameraProvider!!.unbindAll()
      bindPreviewUseCase()
      bindAnalysisUseCase()
    }
  }

  private fun bindPreviewUseCase() {
    if (!PreferenceUtils.isCameraLiveViewportEnabled(this)) {
      return
    }
    if (cameraProvider == null) {
      return
    }
    if (previewUseCase != null) {
      cameraProvider!!.unbind(previewUseCase)
    }

    val builder = Preview.Builder()
    val targetResolution = PreferenceUtils.getCameraXTargetResolution(this, lensFacing)
    if (targetResolution != null) {
      builder.setTargetResolution(targetResolution)
    }
    previewUseCase = builder.build()
    previewUseCase!!.setSurfaceProvider(previewView!!.getSurfaceProvider())
    camera = cameraProvider!!.bindToLifecycle(this, cameraSelector!!, previewUseCase)
  }

  private fun bindAnalysisUseCase() {
    if (cameraProvider == null) {
      return
    }
    if (analysisUseCase != null) {
      cameraProvider!!.unbind(analysisUseCase)
    }
    if (imageProcessor != null) {
      imageProcessor!!.stop()
    }
    imageProcessor =
      try {
        when (selectedModel) {
          TEXT_RECOGNITION_LATIN -> {
            Log.i(TAG, "Using on-device Text recognition Processor for Latin")
            TextRecognitionProcessor(this, TextRecognizerOptions.Builder().build(), textInputField, textViewField)
          }
          else -> throw IllegalStateException("Invalid model name")
        }
      } catch (e: Exception) {
        Log.e(TAG, "Can not create image processor: $selectedModel", e)
        Toast.makeText(
            applicationContext,
            "Can not create image processor: " + e.localizedMessage,
            Toast.LENGTH_LONG,
          )
          .show()
        return
      }

    val builder = ImageAnalysis.Builder()
    val targetResolution = PreferenceUtils.getCameraXTargetResolution(this, lensFacing)
    if (targetResolution != null) {
      builder.setTargetResolution(targetResolution)
    }
    analysisUseCase = builder.build()

    needUpdateGraphicOverlayImageSourceInfo = true

    analysisUseCase?.setAnalyzer(
      // imageProcessor.processImageProxy will use another thread to run the detection underneath,
      // thus we can just runs the analyzer itself on main thread.
      ContextCompat.getMainExecutor(this),
      ImageAnalysis.Analyzer { imageProxy: ImageProxy ->
        if (needUpdateGraphicOverlayImageSourceInfo) {
          val isImageFlipped = lensFacing == CameraSelector.LENS_FACING_FRONT
          val rotationDegrees = imageProxy.imageInfo.rotationDegrees
          if (rotationDegrees == 0 || rotationDegrees == 180) {
            graphicOverlay!!.setImageSourceInfo(imageProxy.width, imageProxy.height, isImageFlipped)
          } else {
            graphicOverlay!!.setImageSourceInfo(imageProxy.height, imageProxy.width, isImageFlipped)
          }
          needUpdateGraphicOverlayImageSourceInfo = false
        }
        try {
          imageProcessor!!.processImageProxy(imageProxy, graphicOverlay)
        } catch (e: MlKitException) {
          Log.e(TAG, "Failed to process image. Error: " + e.localizedMessage)
          Toast.makeText(applicationContext, e.localizedMessage, Toast.LENGTH_SHORT).show()
        }
      },
    )
    cameraProvider!!.bindToLifecycle(this, cameraSelector!!, analysisUseCase)
  }

  companion object {
    private const val TAG = "CameraXLivePreview"
    private const val OBJECT_DETECTION = "Object Detection"
    private const val TEXT_RECOGNITION_LATIN = "Text Recognition Latin"

    private const val STATE_SELECTED_MODEL = "selected_model"
  }
}
